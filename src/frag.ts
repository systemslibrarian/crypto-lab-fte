/**
 * Fragmentation: carrying an authenticated message across several strings.
 *
 * A tag has to live inside the payload, so on a narrow format it competes with
 * the message and wins — a phone number holds 33 bits, four whole bytes, and
 * the frame byte plus the smallest offered tag already need five. `aead.ts`
 * refuses outright, which is honest but leaves the lab's headline format unable
 * to carry an authenticated message at all.
 *
 * The way out is the obvious one: send more than one phone number. What makes
 * it interesting is that a fragment cannot carry its own index or its own tag
 * without spending capacity that a four-byte carrier does not have.
 *
 * ── The layout ─────────────────────────────────────────────────────────────
 *
 *     plaintext = len(2) ‖ message                   (padded to fill)
 *     blob      = AES-CTR(plaintext) ‖ tag(t)        ONE tag for the whole
 *
 *     fragment 0 = 0x01 ‖ total(1) ‖ blob[0 …]
 *     fragment i = 0x01 ‖            blob[… ]
 *
 * Only the first fragment carries a count. The rest carry nothing but payload,
 * because their POSITION is already known: fragment i is sealed under counter
 * `base + i`, so the counter that was already implicit does double duty as the
 * sequence number. That is worth a byte per fragment, which on a two-byte
 * chunk is a third of the channel.
 *
 * There is ONE tag, over the whole blob, not one per fragment. Per-fragment
 * tags would be unaffordable and would also authenticate the wrong thing: what
 * matters is that the reassembled message is intact, not that each piece
 * individually survived.
 *
 * ── Why the receiver can find its way ──────────────────────────────────────
 *
 * It cannot verify a single fragment, because no single fragment has a tag. So
 * it guesses the base counter from its window, decrypts fragment 0 to read the
 * count, decrypts the rest at consecutive counters, reassembles, and checks the
 * one tag. A wrong guess fails that check exactly as a forgery does.
 *
 * ── The cost, stated plainly ───────────────────────────────────────────────
 *
 * A 16-byte message with a 128-bit tag needs 12 phone numbers. Twelve phone
 * numbers in a row is itself a traffic-analysis signal, which is precisely the
 * limitation FTE does not address and this module does not pretend to fix.
 */

import { CompiledFormat } from "./fte.ts";
import {
  bigIntToMinimalBytesBE,
  bytesToBigIntBE,
  bytesToHex,
  cycleWalkDecrypt,
  cycleWalkEncrypt,
  importFf1Key
} from "./ff1.ts";
import { aesCtrDecrypt, aesCtrEncrypt } from "./keys.ts";
import { buildCountTable } from "./rank.ts";
import { rankFixed, unrankFixed } from "./rankct.ts";
import { AuthError, CapacityError, FRAME_BYTE, TagBytes } from "./aead.ts";
import { chainInit, chainNext, equalCT, messageKeys, tag as computeTag } from "./schedule.ts";
import { ReplayWindow, wouldAccept } from "./replay.ts";

/** A count that will not fit in the one byte fragment 0 spends on it. */
export const MAX_FRAGMENTS = 255;
const LENGTH_BYTES = 2;

export interface Plan {
  /** Whole bytes one string carries. */
  payloadBytes: number;
  /** Payload bytes in fragment 0, after the frame byte and the count. */
  firstChunk: number;
  /** Payload bytes in every later fragment, after the frame byte. */
  restChunk: number;
  /** Ciphertext + tag, in bytes. */
  blobBytes: number;
  fragments: number;
  fits: boolean;
  /** Why not, when it does not fit. */
  reason: string | null;
}

export function plan(capacityBits: number, tagBytes: TagBytes, messageBytes: number): Plan {
  const payloadBytes = Math.floor(capacityBits / 8);
  const firstChunk = payloadBytes - 2;
  const restChunk = payloadBytes - 1;
  const blobBytes = LENGTH_BYTES + messageBytes + tagBytes;

  const base: Plan = {
    payloadBytes,
    firstChunk,
    restChunk,
    blobBytes,
    fragments: 0,
    fits: false,
    reason: null
  };

  if (firstChunk < 1) {
    return {
      ...base,
      reason: `This format carries ${payloadBytes} whole byte${payloadBytes === 1 ? "" : "s"} per string, and the frame byte plus the fragment count already need 2. Nothing is left to fragment.`
    };
  }

  const fragments =
    blobBytes <= firstChunk ? 1 : 1 + Math.ceil((blobBytes - firstChunk) / restChunk);

  if (fragments > MAX_FRAGMENTS) {
    return {
      ...base,
      fragments,
      reason: `That would need ${fragments} strings, past the ${MAX_FRAGMENTS} the one-byte count can express.`
    };
  }
  return { ...base, fragments, fits: true };
}

export interface SealedFragments {
  strings: string[];
  baseCounter: number;
  plan: Plan;
  tagHex: string;
  ciphertextHex: string;
}

export interface SealFragmentsInput {
  format: CompiledFormat;
  n: number;
  root: Uint8Array;
  baseCounter: number;
  message: string;
  tagBytes: TagBytes;
}

async function chainFrom(root: Uint8Array, counter: number): Promise<Uint8Array> {
  let chain = await chainInit(root);
  for (let i = 0; i < counter; i += 1) chain = await chainNext(chain);
  return chain;
}

export async function sealFragments(input: SealFragmentsInput): Promise<SealedFragments> {
  const { format, n, root, baseCounter, message, tagBytes } = input;
  const table = buildCountTable(format.dfa, n);
  if (table.total === 0n) throw new CapacityError(`This pattern accepts no string of length ${n}.`);

  const messageBytes = new TextEncoder().encode(message);
  const p = plan(table.capacityBits, tagBytes, messageBytes.length);
  if (!p.fits) throw new CapacityError(p.reason ?? "This message cannot be fragmented into this format.");
  if (messageBytes.length > 0xffff) throw new CapacityError("Message too long to describe in two bytes.");

  // One AES-CTR stream and one MAC for the whole message, keyed from the BASE
  // counter. Each fragment gets its own FF1 key and tweak from its own counter.
  const baseChain = await chainFrom(root, baseCounter);
  const baseKeys = await messageKeys(baseChain);

  const plaintext = new Uint8Array(LENGTH_BYTES + messageBytes.length);
  new DataView(plaintext.buffer).setUint16(0, messageBytes.length, false);
  plaintext.set(messageBytes, LENGTH_BYTES);

  const ciphertext = await aesCtrEncrypt(baseKeys.aesKey, plaintext);
  const mac = await computeTag(baseKeys.macKey, baseCounter, ciphertext, tagBytes);

  const blob = new Uint8Array(ciphertext.length + mac.length);
  blob.set(ciphertext, 0);
  blob.set(mac, ciphertext.length);

  const strings: string[] = [];
  let chain = baseChain;
  let offset = 0;

  for (let i = 0; i < p.fragments; i += 1) {
    const keys = i === 0 ? baseKeys : await messageKeys(chain);
    const payload = new Uint8Array(p.payloadBytes);
    payload[0] = FRAME_BYTE;

    let at = 1;
    if (i === 0) payload[at++] = p.fragments;
    const room = p.payloadBytes - at;
    const slice = blob.slice(offset, offset + room);
    payload.set(slice, at);
    // The tail of the last fragment is zero-filled; `len` says where the
    // message really ends, so the padding needs no marker of its own.
    offset += slice.length;

    const integer = bytesToBigIntBE(payload);
    if (integer >= table.total) throw new CapacityError("A fragment does not fit the language slice.");
    const ff1Key = await importFf1Key(keys.ff1KeyBytes);
    const walk = await cycleWalkEncrypt(ff1Key, table.total, integer, keys.tweak);
    strings.push(unrankFixed(format.dfa, table, walk.value));

    chain = await chainNext(chain);
  }

  return {
    strings,
    baseCounter,
    plan: p,
    tagHex: bytesToHex(mac),
    ciphertextHex: bytesToHex(ciphertext)
  };
}

export interface OpenedFragments {
  message: string;
  baseCounter: number;
  fragments: number;
}

/**
 * Reassemble and verify. Every failure is the same `AuthError` as `aead.open`,
 * for the same reason: a caller must not be able to learn which fragment, which
 * counter, or which check refused it.
 */
export async function openFragments(
  format: CompiledFormat,
  strings: string[],
  root: Uint8Array,
  expectedCounter: number,
  tagBytes: TagBytes,
  window: number,
  /** Freshness, checked against the BASE counter of the message. */
  replay?: ReplayWindow
): Promise<OpenedFragments> {
  if (strings.length === 0) throw new AuthError();

  const n = Array.from(strings[0]).length;
  const table = buildCountTable(format.dfa, n);
  if (table.total === 0n) throw new AuthError();

  let indices: bigint[];
  try {
    indices = strings.map((s) => rankFixed(format.dfa, table, s));
  } catch {
    throw new AuthError();
  }

  const payloadBytes = Math.floor(table.capacityBits / 8);
  let chain = await chainFrom(root, expectedCounter);

  for (let offset = 0; offset < window; offset += 1) {
    const baseCounter = expectedCounter + offset;
    const baseKeys = await messageKeys(chain);
    chain = await chainNext(chain);

    try {
      const decodeAt = async (index: bigint, keys: Awaited<ReturnType<typeof messageKeys>>) => {
        const ff1Key = await importFf1Key(keys.ff1KeyBytes);
        const walk = await cycleWalkDecrypt(ff1Key, table.total, index, keys.tweak);
        const payload = bigIntToMinimalBytesBE(walk.value);
        if (payload.length !== payloadBytes || payload[0] !== FRAME_BYTE) return null;
        return payload;
      };

      const first = await decodeAt(indices[0], baseKeys);
      if (!first) continue;
      const total = first[1];
      if (total < 1 || total > MAX_FRAGMENTS || total !== strings.length) continue;

      const parts: Uint8Array[] = [first.slice(2)];
      let walkChain = await chainNext(await chainFrom(root, baseCounter));
      let ok = true;
      for (let i = 1; i < total; i += 1) {
        const keys = await messageKeys(walkChain);
        walkChain = await chainNext(walkChain);
        const payload = await decodeAt(indices[i], keys);
        if (!payload) {
          ok = false;
          break;
        }
        parts.push(payload.slice(1));
      }
      if (!ok) continue;

      const blob = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) {
        blob.set(part, at);
        at += part.length;
      }

      // The blob is zero-padded at the tail; the ciphertext length follows from
      // where the tag sits, which follows from the declared message length.
      const plaintextProbe = await aesCtrDecrypt(baseKeys.aesKey, blob.slice(0, LENGTH_BYTES));
      const declared = new DataView(
        plaintextProbe.buffer,
        plaintextProbe.byteOffset,
        plaintextProbe.byteLength
      ).getUint16(0, false);

      const ciphertextLen = LENGTH_BYTES + declared;
      if (ciphertextLen + tagBytes > blob.length) continue;

      const ciphertext = blob.slice(0, ciphertextLen);
      const offered = blob.slice(ciphertextLen, ciphertextLen + tagBytes);
      const expected = await computeTag(baseKeys.macKey, baseCounter, ciphertext, tagBytes);
      if (!equalCT(offered, expected)) continue;
      if (replay && wouldAccept(replay, baseCounter) !== true) throw new AuthError();

      const plaintext = await aesCtrDecrypt(baseKeys.aesKey, ciphertext);
      const message = new TextDecoder("utf-8", { fatal: true }).decode(plaintext.slice(LENGTH_BYTES));
      return { message, baseCounter, fragments: total };
    } catch {
      continue;
    }
  }

  throw new AuthError();
}
