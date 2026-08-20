/**
 * The authenticated mode: items 1, 2 and 5, standing on 3, 4 and 6.
 *
 * This runs BESIDE the unauthenticated pipeline rather than replacing it. The
 * page's third honest limitation — no MAC, and a frame byte that admits 43% of
 * wrong keys on the phone format — is one of the most valuable things on it,
 * and it can only be demonstrated by a mode that actually lacks a MAC.
 *
 * ── The wire format ────────────────────────────────────────────────────────
 *
 *     payload = 0x01 ‖ ciphertext(P) ‖ tag(t)          then FF1'd, then unranked
 *
 * and that is the whole of it. Note what is NOT there:
 *
 *   - No salt. The FF1 tweak comes from the counter (see `schedule.ts`), so
 *     nothing travels beside the stego string. The unauthenticated mode has to
 *     ship 16 bytes of salt out of band; this one ships nothing.
 *   - No sequence number. The counter is implicit — sender and receiver each
 *     keep their own and the receiver searches a window forward to resync.
 *     Transmitting it would cost 32 bits, and on a 33-bit format that is the
 *     difference between possible and impossible.
 *
 * The 0x01 frame byte stays, but its job is now purely structural: a big-endian
 * integer cannot remember its leading zero bytes, so the byte pins the length.
 * It is no longer doing any security work, because the tag is.
 *
 * ── Encrypt-then-MAC ───────────────────────────────────────────────────────
 *
 * The tag covers the counter and the ciphertext, and it is computed over the
 * CIPHERTEXT, not the plaintext. Verification happens before the plaintext is
 * touched at all. Because FF1 is a permutation, a substituted string inverts to
 * a uniformly random integer, so a forged payload's tag matches with
 * probability 2^-8t and nothing else about it is ever examined.
 *
 * ── One failure, always ────────────────────────────────────────────────────
 *
 * Every rejection — wrong counter, bad frame byte, failed tag, broken padding,
 * invalid UTF-8, a string outside the language — raises the SAME `AuthError`
 * with the SAME message. The unauthenticated decoder distinguishes "no frame
 * marker" from "not valid UTF-8", which is a two-state oracle an attacker can
 * query; you can watch it do exactly that in the substitution panel. Here there
 * is nothing to learn from a refusal but that it was refused.
 */

import { CompiledFormat } from "./fte.ts";
import {
  bigIntToMinimalBytesBE,
  bytesToBigIntBE,
  bytesToHex,
  cycleWalkDecrypt,
  cycleWalkEncrypt,
  importFf1Key,
  walkWidth
} from "./ff1.ts";
import { aesCtrDecrypt, aesCtrEncrypt } from "./keys.ts";
import { CountTable, buildCountTable } from "./rank.ts";
import { rankFixed, unrankFixed } from "./rankct.ts";
import { ReplayWindow, wouldAccept } from "./replay.ts";
import {
  DEFAULT_WINDOW,
  MessageKeys,
  chainInit,
  chainNext,
  equalCT,
  messageKeys,
  tag as computeTag
} from "./schedule.ts";

export const FRAME_BYTE = 0x01;
export const PAD_MARKER = 0x80;

/** Tag sizes the mode offers, widest first. Below 4 bytes is not offered. */
export const TAG_CHOICES = [16, 8, 4] as const;
export type TagBytes = (typeof TAG_CHOICES)[number];

/**
 * The single error every failure raises, with the single message every failure
 * carries. Do not add a `reason` field to this class.
 */
export class AuthError extends Error {
  constructor() {
    super("Authentication failed. The string, the passphrase, or the counter does not match.");
    this.name = "AuthError";
  }
}

/** Raised when the FORMAT cannot hold an authenticated message at all. */
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityError";
  }
}

export interface Budget {
  capacityBits: number;
  /** Whole bytes the slice can carry. */
  payloadBytes: number;
  /** Frame byte + tag. */
  overheadBytes: number;
  /** The fixed padded-plaintext size, P. */
  plaintextBytes: number;
  /** Longest message, in bytes: P minus the one byte padding always costs. */
  maxMessageBytes: number;
  fits: boolean;
  /** log2 of a forger's per-attempt success probability, as a positive number. */
  forgeryBits: number;
}

/**
 * What an authenticated message costs in this format.
 *
 * This is the arithmetic that decides whether the mode can run at all, and it
 * is the reason a phone number cannot carry one: 33 bits is four whole bytes,
 * the frame byte takes one, and the smallest tag on offer takes four.
 */
export function budget(capacityBits: number, tagBytes: TagBytes): Budget {
  const payloadBytes = Math.floor(capacityBits / 8);
  const overheadBytes = 1 + tagBytes;
  const plaintextBytes = payloadBytes - overheadBytes;
  const maxMessageBytes = plaintextBytes - 1;
  return {
    capacityBits,
    payloadBytes,
    overheadBytes,
    plaintextBytes,
    maxMessageBytes,
    fits: maxMessageBytes >= 1,
    forgeryBits: 8 * tagBytes
  };
}

/**
 * Fixed-size padding: message ‖ 0x80 ‖ 0x00…  (ISO/IEC 7816-4).
 *
 * EVERY message becomes exactly P bytes, so the ciphertext length — and
 * therefore the wire length — is constant for the whole mode. That is item 5:
 * two messages of different sizes are no longer distinguishable by the length
 * of what they produce, which is the leak the ladder in the limitations section
 * tabulates for the unauthenticated mode.
 */
export function pad(message: Uint8Array, plaintextBytes: number): Uint8Array {
  if (message.length > plaintextBytes - 1) {
    throw new CapacityError(
      `This message is ${message.length} bytes and the padded block is ${plaintextBytes}, ` +
        `which leaves room for ${plaintextBytes - 1}. Shorten it, widen the format, or use a shorter tag.`
    );
  }
  const out = new Uint8Array(plaintextBytes);
  out.set(message, 0);
  out[message.length] = PAD_MARKER;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  for (let i = padded.length - 1; i >= 0; i -= 1) {
    if (padded[i] === PAD_MARKER) return padded.slice(0, i);
    if (padded[i] !== 0x00) break;
  }
  // Only reachable on a genuine bug, since the tag has already verified.
  throw new AuthError();
}

export interface SealTrace {
  counter: number;
  plaintextBytes: number;
  tagBytes: number;
  ciphertextHex: string;
  tagHex: string;
  integer: bigint;
  domain: bigint;
  walkBits: number;
  walkSteps: number;
  aesKeyHex: string;
  tweakHex: string;
}

export interface SealResult {
  stego: string;
  n: number;
  counter: number;
  total: bigint;
  budget: Budget;
  trace: SealTrace;
}

async function payloadFor(
  keys: MessageKeys,
  counter: number,
  message: string,
  b: Budget
): Promise<{ payload: Uint8Array; ciphertext: Uint8Array; tagBytes: Uint8Array }> {
  const plaintext = pad(new TextEncoder().encode(message), b.plaintextBytes);
  const ciphertext = await aesCtrEncrypt(keys.aesKey, plaintext);
  const tagBytes = await computeTag(keys.macKey, counter, ciphertext, b.overheadBytes - 1);

  const payload = new Uint8Array(1 + ciphertext.length + tagBytes.length);
  payload[0] = FRAME_BYTE;
  payload.set(ciphertext, 1);
  payload.set(tagBytes, 1 + ciphertext.length);
  return { payload, ciphertext, tagBytes };
}

export interface SealInput {
  format: CompiledFormat;
  n: number;
  root: Uint8Array;
  counter: number;
  message: string;
  tagBytes: TagBytes;
}

/**
 * Encrypt, authenticate, encipher, unrank.
 *
 * `n` is NEVER grown. The unauthenticated encoder widens the format when a
 * message will not fit, which turns message length into wire length; here a
 * message that does not fit is refused, and the refusal names the arithmetic.
 */
export async function seal(input: SealInput): Promise<SealResult> {
  const { format, n, root, counter, message, tagBytes } = input;

  const table = buildCountTable(format.dfa, n);
  if (table.total === 0n) {
    throw new CapacityError(`This pattern accepts no string of length ${n}.`);
  }
  const b = budget(table.capacityBits, tagBytes);
  if (!b.fits) {
    throw new CapacityError(
      `An authenticated message does not fit. This slice holds ${b.capacityBits} bits — ` +
        `${b.payloadBytes} whole bytes — and the frame byte plus a ${tagBytes}-byte tag already ` +
        `need ${b.overheadBytes}. Use a wider format or a shorter tag.`
    );
  }

  let chain = await chainInit(root);
  for (let i = 0; i < counter; i += 1) chain = await chainNext(chain);
  const keys = await messageKeys(chain);

  const { payload, ciphertext, tagBytes: mac } = await payloadFor(keys, counter, message, b);
  const integer = bytesToBigIntBE(payload);
  if (integer >= table.total) {
    throw new CapacityError("The framed payload does not fit the language slice.");
  }

  const ff1Key = await importFf1Key(keys.ff1KeyBytes);
  const walk = await cycleWalkEncrypt(ff1Key, table.total, integer, keys.tweak);
  const stego = unrankFixed(format.dfa, table, walk.value);

  return {
    stego,
    n,
    counter,
    total: table.total,
    budget: b,
    trace: {
      counter,
      plaintextBytes: b.plaintextBytes,
      tagBytes: tagBytes,
      ciphertextHex: bytesToHex(ciphertext),
      tagHex: bytesToHex(mac),
      integer,
      domain: table.total,
      walkBits: walkWidth(table.total),
      walkSteps: walk.steps,
      aesKeyHex: keys.aesKeyHex,
      tweakHex: bytesToHex(keys.tweak)
    }
  };
}

export interface OpenResult {
  message: string;
  /** The counter the string turned out to belong to. */
  counter: number;
  /** How many counters were tried before this one matched. */
  searched: number;
}

/**
 * Verify, then decrypt — in that order, and never the other way round.
 *
 * The counter is implicit, so this walks its window and asks each candidate the
 * same question. A wrong candidate derived different keys, so its recomputed
 * tag cannot match, and it is rejected by exactly the path a forgery is: that
 * is what keeps the counter off the wire without weakening anything.
 *
 * Every failure raises the same `AuthError`. There is no path out of this
 * function that tells a caller which check refused it.
 */
export async function open(
  format: CompiledFormat,
  stego: string,
  root: Uint8Array,
  expectedCounter: number,
  tagBytes: TagBytes,
  window: number = DEFAULT_WINDOW,
  /**
   * Optional freshness check. A verified message is authentic but not
   * necessarily NEW — the same string replayed carries the same valid tag it
   * always did. When a window is supplied, a counter it has already accepted is
   * refused through the same path as a forgery, and the caller records the
   * counter itself so a message rejected downstream does not burn it.
   */
  replay?: ReplayWindow
): Promise<OpenResult> {
  const n = Array.from(stego).length;
  let table: CountTable;
  let index: bigint;
  try {
    table = buildCountTable(format.dfa, n);
    if (table.total === 0n) throw new AuthError();
    index = rankFixed(format.dfa, table, stego);
  } catch {
    // Not a member of the language — same refusal as a failed tag.
    throw new AuthError();
  }

  const b = budget(table.capacityBits, tagBytes);
  if (!b.fits) throw new AuthError();

  let chain = await chainInit(root);
  for (let i = 0; i < expectedCounter; i += 1) chain = await chainNext(chain);

  for (let offset = 0; offset < window; offset += 1) {
    const counter = expectedCounter + offset;
    const keys = await messageKeys(chain);
    chain = await chainNext(chain);

    try {
      const ff1Key = await importFf1Key(keys.ff1KeyBytes);
      const walk = await cycleWalkDecrypt(ff1Key, table.total, index, keys.tweak);
      const payload = bigIntToMinimalBytesBE(walk.value);

      // Shape checks. All of them fall through to the next candidate rather
      // than reporting anything, so none is observable on its own.
      if (payload.length !== b.payloadBytes) continue;
      if (payload[0] !== FRAME_BYTE) continue;

      const ciphertext = payload.slice(1, 1 + b.plaintextBytes);
      const offered = payload.slice(1 + b.plaintextBytes);
      const expected = await computeTag(keys.macKey, counter, ciphertext, tagBytes);
      if (!equalCT(offered, expected)) continue;

      // Authentic. Now, is it fresh? Same refusal either way.
      if (replay && wouldAccept(replay, counter) !== true) throw new AuthError();

      // Only now is the plaintext touched.
      const padded = await aesCtrDecrypt(keys.aesKey, ciphertext);
      const message = new TextDecoder("utf-8", { fatal: true }).decode(unpad(padded));
      return { message, counter, searched: offset + 1 };
    } catch {
      continue;
    }
  }

  throw new AuthError();
}
