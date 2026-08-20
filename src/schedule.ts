/**
 * The key schedule for the authenticated mode: items 3 and 4.
 *
 * The unauthenticated demo runs PBKDF2 at 600,000 iterations for EVERY message
 * and ships a fresh random salt out of band beside each one. That is the right
 * shape for a passphrase toy and the wrong shape for a protocol: a second of
 * work per message, and a side channel you have to operate.
 *
 * Here PBKDF2 runs ONCE, to turn a passphrase into a root key — standing in for
 * the handshake a real deployment would run (X25519 / Noise). Everything after
 * that is HKDF-SHA256, which is microseconds.
 *
 * ── The ratchet ────────────────────────────────────────────────────────────
 *
 *     chain[0]   = HKDF(root,     info "chain-init")
 *     mk[i]      = HKDF(chain[i], info "message")      → AES key, MAC key,
 *                                                        FF1 key, FF1 tweak
 *     chain[i+1] = HKDF(chain[i], info "chain-next")
 *
 * Distinct `info` strings on the same input give independent outputs, so one
 * chain key yields a message key and its own successor without either exposing
 * the other. Discard chain[i] after use and messages before i stay sealed even
 * if the device is later seized.
 *
 * HONESTY, because this is exactly where a demo would overclaim: forward
 * secrecy here is STRUCTURAL, NOT ACHIEVED. This page derives the root from a
 * passphrase on every load, so anyone with the passphrase can recompute every
 * chain key from scratch. A real deployment gets the property by persisting
 * only the current chain key and destroying the root — the schedule below is
 * built so that is a storage decision rather than a redesign.
 *
 * ── No salt on the wire ────────────────────────────────────────────────────
 *
 * The FF1 tweak is derived from the message counter, not from a random salt, so
 * nothing has to travel beside the stego string. The counter is IMPLICIT: it is
 * never transmitted, which also buys back the 32 bits a sequence number would
 * have cost — and on a format with 33 bits of capacity that is the difference
 * between possible and not. Receivers track their own counter and search a
 * small window forward to resynchronise after loss.
 */

import { PBKDF2_HASH, PBKDF2_ITERATIONS } from "./keys.ts";

export const ROOT_BYTES = 32;
export const AES_KEY_BYTES = 32;
export const MAC_KEY_BYTES = 32;
export const FF1_KEY_BYTES = 16;
export const TWEAK_BYTES = 8;

/** How far ahead of its own counter a receiver will search. */
export const DEFAULT_WINDOW = 32;

const LABEL = "crypto-lab-fte/v1";

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto SubtleCrypto is required and is not available in this context.");
  }
  return globalThis.crypto.subtle;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function label(suffix: string): Uint8Array {
  return new TextEncoder().encode(`${LABEL}/${suffix}`);
}

/**
 * HKDF-SHA256 with an empty salt. Empty is correct here rather than lazy: the
 * input keying material is already a uniformly random 32-byte key, so the
 * extract step has nothing to condition, and domain separation is carried
 * entirely by `info`.
 */
async function hkdf(ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", buf(ikm), { name: "HKDF" }, false, ["deriveBits"]);
  const out = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: buf(info) },
    key,
    bytes * 8
  );
  return new Uint8Array(out);
}

/**
 * The handshake stand-in. Run once per passphrase, never per message.
 *
 * The salt is a fixed label rather than a random value because there is no
 * per-message salt in this mode at all — the counter provides the variation.
 * A real deployment replaces this whole function with a key agreement.
 */
export async function deriveRoot(passphrase: string): Promise<Uint8Array> {
  if (passphrase.length === 0) throw new Error("A passphrase is required.");
  const base = await subtle().importKey(
    "raw",
    buf(new TextEncoder().encode(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await subtle().deriveBits(
    {
      name: "PBKDF2",
      salt: buf(label("root-salt")),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    base,
    ROOT_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function chainInit(root: Uint8Array): Promise<Uint8Array> {
  return hkdf(root, label("chain-init"), ROOT_BYTES);
}

export async function chainNext(chain: Uint8Array): Promise<Uint8Array> {
  return hkdf(chain, label("chain-next"), ROOT_BYTES);
}

export interface MessageKeys {
  aesKey: CryptoKey;
  macKey: CryptoKey;
  ff1KeyBytes: Uint8Array;
  /** The FF1 tweak, derived from the counter rather than shipped beside it. */
  tweak: Uint8Array;
  /** Hex of the AES key, for the step trace. Never leaves the tab. */
  aesKeyHex: string;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One chain key yields exactly one message's worth of key material. */
export async function messageKeys(chain: Uint8Array): Promise<MessageKeys> {
  const total = AES_KEY_BYTES + MAC_KEY_BYTES + FF1_KEY_BYTES + TWEAK_BYTES;
  const bits = await hkdf(chain, label("message"), total);

  let at = 0;
  const aesBytes = bits.slice(at, (at += AES_KEY_BYTES));
  const macBytes = bits.slice(at, (at += MAC_KEY_BYTES));
  const ff1KeyBytes = bits.slice(at, (at += FF1_KEY_BYTES));
  const tweak = bits.slice(at, at + TWEAK_BYTES);

  return {
    aesKey: await subtle().importKey("raw", buf(aesBytes), { name: "AES-CTR" }, false, [
      "encrypt",
      "decrypt"
    ]),
    macKey: await subtle().importKey(
      "raw",
      buf(macBytes),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    ),
    ff1KeyBytes,
    tweak,
    aesKeyHex: hex(aesBytes)
  };
}

/** Ratchet from chain[0] to chain[n]. O(n) HKDF calls, microseconds each. */
export async function chainAt(root: Uint8Array, counter: number): Promise<Uint8Array> {
  let chain = await chainInit(root);
  for (let i = 0; i < counter; i += 1) chain = await chainNext(chain);
  return chain;
}

/**
 * HMAC-SHA256 over the counter and the ciphertext, truncated.
 *
 * The counter is authenticated even though it is never transmitted: a receiver
 * that guessed the wrong counter derived different keys, so its recomputed tag
 * cannot match, and a wrong guess is rejected exactly like a forgery. That is
 * what lets the counter stay off the wire.
 *
 * Truncation is a real security parameter, not a formality — a t-byte tag gives
 * a forger 2^-8t per attempt. The caller chooses t against its capacity budget
 * and the page states the resulting bound.
 */
export async function tag(
  macKey: CryptoKey,
  counter: number,
  ciphertext: Uint8Array,
  tagBytes: number
): Promise<Uint8Array> {
  const header = label("tag");
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);

  const input = new Uint8Array(header.length + counterBytes.length + ciphertext.length);
  input.set(header, 0);
  input.set(counterBytes, header.length);
  input.set(ciphertext, header.length + counterBytes.length);

  const mac = new Uint8Array(await subtle().sign("HMAC", macKey, buf(input)));
  return mac.slice(0, tagBytes);
}

/**
 * Constant-time equality. Compares every byte regardless of where they diverge,
 * so the time taken says nothing about how much of a forged tag was right.
 */
export function equalCT(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
