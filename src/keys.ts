/**
 * Key derivation and the message cipher — both real WebCrypto, no shims.
 *
 * One PBKDF2-SHA256 pass at 600,000 iterations (the OWASP 2023 floor for
 * PBKDF2-HMAC-SHA256) over the passphrase and a fresh 16-byte random salt
 * produces 384 bits, split into two independent keys:
 *
 *     bits[0..32)   AES-256-CTR — encrypts the message
 *     bits[32..48)  AES-128     — the FF1 round function's block cipher
 *
 * Splitting one derivation is what keeps the demo responsive: 600k iterations is
 * roughly a second of work, and doing it twice to domain-separate would double
 * that for no security gain — distinct, non-overlapping ranges of one PRF output
 * are already independent.
 *
 * ── The counter block ──────────────────────────────────────────────────────
 * AES-CTR here runs from an all-zero counter. That is safe *only* because the
 * salt is fresh for every encode, so the AES-256 key is never reused across two
 * messages. Encrypt two different messages under the same passphrase AND the
 * same salt and the keystream repeats — the classic two-time pad. The UI
 * generates a new salt on every encode for exactly this reason, and the salt is
 * displayed rather than hidden so the reuse is visible if it ever happens.
 */

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH = "SHA-256";
export const SALT_BYTES = 16;

/** 256 bits for AES-CTR + 128 bits for FF1. */
const DERIVED_BITS = 384;

export interface DerivedKeys {
  /** AES-256-CTR key for the message cipher. */
  messageKey: CryptoKey;
  /** The raw 128 bits handed to FF1, so the UI can show what was derived. */
  ff1KeyBytes: Uint8Array;
  /** Hex of the AES-CTR key, shown in the step trace. */
  messageKeyHex: string;
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto SubtleCrypto is required and is not available in this context.");
  }
  return globalThis.crypto.subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

export async function deriveKeys(passphrase: string, salt: Uint8Array): Promise<DerivedKeys> {
  if (passphrase.length === 0) throw new Error("A passphrase is required.");
  if (salt.length !== SALT_BYTES) throw new Error(`The salt must be exactly ${SALT_BYTES} bytes.`);

  const base = await subtle().importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = new Uint8Array(
    await subtle().deriveBits(
      {
        name: "PBKDF2",
        salt: toArrayBuffer(salt),
        iterations: PBKDF2_ITERATIONS,
        hash: PBKDF2_HASH
      },
      base,
      DERIVED_BITS
    )
  );

  const messageKeyBytes = bits.slice(0, 32);
  const ff1KeyBytes = bits.slice(32, 48);
  const messageKey = await subtle().importKey(
    "raw",
    toArrayBuffer(messageKeyBytes),
    { name: "AES-CTR" },
    false,
    ["encrypt", "decrypt"]
  );

  return { messageKey, ff1KeyBytes, messageKeyHex: hex(messageKeyBytes) };
}

/** The all-zero counter block. See the note at the top of this file. */
function counterBlock(): Uint8Array {
  return new Uint8Array(16);
}

export async function aesCtrEncrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().encrypt(
    { name: "AES-CTR", counter: toArrayBuffer(counterBlock()), length: 64 },
    key,
    toArrayBuffer(data)
  );
  return new Uint8Array(out);
}

/** AES-CTR is its own inverse; kept as a named function so call sites read right. */
export async function aesCtrDecrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().decrypt(
    { name: "AES-CTR", counter: toArrayBuffer(counterBlock()), length: 64 },
    key,
    toArrayBuffer(data)
  );
  return new Uint8Array(out);
}
