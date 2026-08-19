/**
 * The FTE pipeline: passphrase + message + regex → a string the regex accepts.
 *
 *   encode:  message ──AES-CTR──▶ ciphertext ──frame──▶ I ──FF1 (cycle-walked
 *            over N)──▶ i ──unrank──▶ stego string
 *   decode:  stego string ──rank──▶ i ──FF1⁻¹──▶ I ──unframe──▶ ciphertext
 *            ──AES-CTR──▶ message
 *
 * ── The 0x01 frame byte ────────────────────────────────────────────────────
 * The integer I is the ciphertext read big-endian, and a big-endian integer
 * cannot remember how many leading zero bytes it had. Without help, a ciphertext
 * starting `00 7f …` would decode one byte short. So the ciphertext is prefixed
 * with a single 0x01 before the conversion, which makes the byte length
 * recoverable exactly: strip the leading 0x01 back off and what remains is the
 * ciphertext, zero bytes and all.
 *
 * That byte is NOT integrity protection, and it is much weaker than it looks.
 * The obvious guess — "a wrong key passes it 1 time in 256" — is wrong, because
 * the leading byte of a MINIMAL big-endian encoding is not uniform over 0..255.
 * A wrong passphrase produces a value uniform in [0, N), and for the phone
 * preset (N = 10^10) about 43% of that range has leading byte 0x01: the whole
 * of [2^32, 2^33) sits inside it.
 *
 * `src/fte.test.ts` computes the rate in closed form for every shipped preset.
 * It is 1/255 for hex and base64 — whose N is an exact power of 256, which is
 * the coincidence that makes the folklore number sound right — 0.004 for IPv4,
 * and 0.431 for the phone number. A check whose strength swings by two orders
 * of magnitude depending on whether the format's slice happens to be
 * byte-aligned is exactly what a real MAC is not. The strict UTF-8 decode
 * behind it catches most of what gets through. "Most" is not a security
 * property. See the No authentication limitation on the page.
 */

import {
  Dfa,
  DfaTooLargeError,
  MAX_DFA_STATES,
  buildDfa
} from "./regex/dfa.ts";
import { buildNfa } from "./regex/nfa.ts";
import { RegexError, parseRegex } from "./regex/parser.ts";
import {
  CountTable,
  MAX_N,
  buildCountTable,
  capacityBitsOf,
  rank,
  scanCapacity,
  smallestLengthFor,
  unrank
} from "./rank.ts";
import {
  bigIntToMinimalBytesBE,
  bytesToBigIntBE,
  bytesToHex,
  cycleWalkDecrypt,
  cycleWalkEncrypt,
  importFf1Key,
  walkWidth
} from "./ff1.ts";
import { aesCtrDecrypt, aesCtrEncrypt, deriveKeys, randomSalt } from "./keys.ts";

/** The lab's stated floor: a format that cannot hold a byte is not a format. */
export const MIN_USEFUL_CAPACITY_BITS = 8;

export const FRAME_BYTE = 0x01;

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export interface CompiledFormat {
  pattern: string;
  dfa: Dfa;
  /** C[q0][k] for k = 0 … MAX_N. */
  counts: bigint[];
  /** The shortest accepted length, or null if the language is empty. */
  shortestN: number | null;
  /** The largest capacity any n ≤ MAX_N reaches. */
  maxCapacityBits: number;
  /** The n at which that maximum is reached. */
  maxCapacityN: number;
}

/**
 * Parse → NFA → DFA → capacity ladder, with the two rejections the lab promises:
 * over 4096 states, or under 8 bits of capacity at every length up to n_max.
 */
export function compileFormat(pattern: string, maxN: number = MAX_N): CompiledFormat {
  const ast = parseRegex(pattern);
  const nfa = buildNfa(ast);
  const dfa = buildDfa(nfa);
  if (dfa.numStates > MAX_DFA_STATES) throw new DfaTooLargeError(dfa.numStates, MAX_DFA_STATES);

  const counts = scanCapacity(dfa, maxN);
  let shortestN: number | null = null;
  let maxCapacityBits = 0;
  let maxCapacityN = 0;
  for (let n = 0; n < counts.length; n += 1) {
    if (counts[n] > 0n && shortestN === null) shortestN = n;
    const bits = capacityBitsOf(counts[n]);
    if (bits > maxCapacityBits) {
      maxCapacityBits = bits;
      maxCapacityN = n;
    }
  }

  if (shortestN === null) {
    throw new FormatError("This pattern matches no string of length ≤ " + maxN + ".");
  }
  if (maxCapacityBits < MIN_USEFUL_CAPACITY_BITS) {
    throw new FormatError(
      `At every length up to n_max = ${maxN} this pattern accepts at most ` +
        `${counts[maxCapacityN]} string(s) — ${maxCapacityBits} bits of capacity, under the ` +
        `${MIN_USEFUL_CAPACITY_BITS}-bit floor. A format has to have choices in it to hide anything.`
    );
  }

  return { pattern, dfa, counts, shortestN, maxCapacityBits, maxCapacityN };
}

/** Bits of payload a message of this many UTF-8 bytes needs, frame byte included. */
export function payloadBitsFor(byteLength: number): number {
  return 8 * (byteLength + 1);
}

export interface EncodeTrace {
  messageBytes: number;
  ciphertextHex: string;
  /** I — the framed ciphertext read as one big-endian integer. */
  integer: bigint;
  integerBits: number;
  /** N = |L ∩ Σ^n|. */
  domain: bigint;
  /** k, the binary width FF1 actually permutes. */
  walkBits: number;
  /** FF1 output, already inside [0, N). */
  ciphered: bigint;
  /** FF1 applications the cycle walk took. 1 = landed first try. */
  walkSteps: number;
  ff1KeyHex: string;
  messageKeyHex: string;
}

export interface EncodeResult {
  stego: string;
  salt: Uint8Array;
  saltHex: string;
  /** The n actually used — may exceed the requested n if the message needed room. */
  n: number;
  requestedN: number;
  total: bigint;
  capacityBits: number;
  payloadBits: number;
  table: CountTable;
  trace: EncodeTrace;
}

export interface EncodeInput {
  format: CompiledFormat;
  n: number;
  message: string;
  passphrase: string;
  /** Supplied only by tests and the round-trip check; the UI always draws fresh. */
  salt?: Uint8Array;
}

export async function encode(input: EncodeInput): Promise<EncodeResult> {
  const { format, message, passphrase } = input;
  const salt = input.salt ?? randomSalt();
  const keys = await deriveKeys(passphrase, salt);

  const messageBytes = new TextEncoder().encode(message);
  const ciphertext = await aesCtrEncrypt(keys.messageKey, messageBytes);

  const framed = new Uint8Array(ciphertext.length + 1);
  framed[0] = FRAME_BYTE;
  framed.set(ciphertext, 1);
  const integer = bytesToBigIntBE(framed);
  const payloadBits = payloadBitsFor(ciphertext.length);

  const n = chooseLength(format, input.n, payloadBits);
  const table = buildCountTable(format.dfa, n);
  if (integer >= table.total) {
    // Belt and braces: chooseLength guarantees this, and a silent modular wrap
    // here would be an unrecoverable corruption rather than an error.
    throw new FormatError("The framed ciphertext does not fit the chosen language slice.");
  }

  const ff1Key = await importFf1Key(keys.ff1KeyBytes);
  const walk = await cycleWalkEncrypt(ff1Key, table.total, integer, salt);
  const stego = unrank(format.dfa, table, walk.value);

  return {
    stego,
    salt,
    saltHex: bytesToHex(salt),
    n,
    requestedN: input.n,
    total: table.total,
    capacityBits: table.capacityBits,
    payloadBits,
    table,
    trace: {
      messageBytes: messageBytes.length,
      ciphertextHex: bytesToHex(ciphertext),
      integer,
      integerBits: integer.toString(2).length,
      domain: table.total,
      walkBits: walkWidth(table.total),
      ciphered: walk.value,
      walkSteps: walk.steps,
      ff1KeyHex: bytesToHex(keys.ff1KeyBytes),
      messageKeyHex: keys.messageKeyHex
    }
  };
}

/**
 * The smallest usable n: the requested one if the payload fits, otherwise the
 * shortest length that does. The caller is told which happened so the UI can say
 * "this needed 24 characters, not 14" rather than silently changing the format.
 */
export function chooseLength(format: CompiledFormat, requested: number, payloadBits: number): number {
  const requestedCapacity =
    requested >= 0 && requested < format.counts.length ? capacityBitsOf(format.counts[requested]) : 0;
  if (format.counts[requested] > 0n && requestedCapacity >= payloadBits) return requested;

  const fit = smallestLengthFor(format.counts, payloadBits);
  if (fit === null) {
    throw new FormatError(
      `This message needs ${payloadBits} bits, and the pattern tops out at ` +
        `${format.maxCapacityBits} bits (n = ${format.maxCapacityN}, the widest slice under ` +
        `n_max = ${MAX_N}). Shorten the message or widen the pattern.`
    );
  }
  return fit.n;
}

export interface DecodeResult {
  message: string;
  n: number;
  total: bigint;
  index: bigint;
  integer: bigint;
  ciphertextHex: string;
  walkSteps: number;
}

export interface DecodeInput {
  format: CompiledFormat;
  stego: string;
  passphrase: string;
  salt: Uint8Array;
}

export async function decode(input: DecodeInput): Promise<DecodeResult> {
  const { format, stego, passphrase, salt } = input;
  const n = Array.from(stego).length;
  if (n === 0) throw new FormatError("Nothing to decode.");
  if (n > MAX_N) throw new FormatError(`The stego string is longer than n_max = ${MAX_N}.`);

  const table = buildCountTable(format.dfa, n);
  if (table.total === 0n) {
    throw new FormatError(
      `The current pattern accepts no string of length ${n}, so this text cannot have come from it.`
    );
  }
  const index = rank(format.dfa, table, stego);

  const keys = await deriveKeys(passphrase, salt);
  const ff1Key = await importFf1Key(keys.ff1KeyBytes);
  const walk = await cycleWalkDecrypt(ff1Key, table.total, index, salt);

  const framed = bigIntToMinimalBytesBE(walk.value);
  if (framed[0] !== FRAME_BYTE) {
    throw new FormatError(
      "Decode failed: the recovered bytes have no frame marker. The passphrase, the salt, or the pattern does not match the one used to encode."
    );
  }
  const ciphertext = framed.slice(1);
  const plaintextBytes = await aesCtrDecrypt(keys.messageKey, ciphertext);

  let message: string;
  try {
    message = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
  } catch {
    throw new FormatError(
      "Decode failed: the recovered bytes are not valid UTF-8. The passphrase or the salt does not match."
    );
  }

  return {
    message,
    n,
    total: table.total,
    index,
    integer: walk.value,
    ciphertextHex: bytesToHex(ciphertext),
    walkSteps: walk.steps
  };
}

export { RegexError, DfaTooLargeError };
