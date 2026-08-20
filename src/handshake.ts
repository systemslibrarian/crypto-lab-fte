/**
 * A real key agreement, in place of the passphrase stand-in.
 *
 * `schedule.ts` derives its root key by running PBKDF2 over a passphrase, and
 * says in its own comments that it is standing in for a handshake. This is the
 * handshake. Two parties generate ephemeral key pairs, exchange public keys
 * over a channel the adversary may read, and derive the same 32-byte root from
 * a secret that never crossed it.
 *
 * ── Curve choice ───────────────────────────────────────────────────────────
 *
 * X25519 where the browser has it — it is the modern default, the public key
 * is 32 bytes rather than 65, and it has no invalid-curve pitfalls to get
 * wrong. WebCrypto only gained it recently (Chrome 133), so P-256 ECDH is kept
 * as a fallback rather than shutting older browsers out of the panel. Which one
 * ran is reported rather than hidden, because a reader comparing two machines
 * should be able to see why their public keys are different lengths.
 *
 * ── Transcript binding ─────────────────────────────────────────────────────
 *
 * The root is not the raw shared secret. It is HKDF over the shared secret with
 * BOTH public keys, sorted, in the `info` string. Sorting is what lets the two
 * sides build an identical transcript without agreeing who is "first", and
 * binding the transcript is what stops an adversary who can relay messages from
 * splicing halves of two different exchanges together and having both sides
 * derive the same root for different reasons.
 *
 * ── What this is still not ─────────────────────────────────────────────────
 *
 * Unauthenticated Diffie-Hellman is wide open to an active machine-in-the-
 * middle: nothing here proves whose public key you received. A real deployment
 * signs the transcript with a long-term identity key, or pins the peer's key
 * out of band, or runs a full Noise pattern. The panel says so, and the code
 * does not pretend otherwise by calling this "authenticated".
 */

import { ROOT_BYTES } from "./schedule.ts";

export type Suite = "X25519" | "P-256";

export interface Identity {
  suite: Suite;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** Raw public key, hex — this is what crosses the channel. */
  publicKeyHex: string;
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto SubtleCrypto is required and is not available in this context.");
  }
  return globalThis.crypto.subtle;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(text: string): Uint8Array {
  const clean = text.trim().toLowerCase().replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error("A public key must be an even number of hex characters.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function params(suite: Suite): AlgorithmIdentifier | EcKeyGenParams {
  return suite === "X25519" ? { name: "X25519" } : { name: "ECDH", namedCurve: "P-256" };
}

/** X25519 if this browser has it, otherwise P-256. Probed, not assumed. */
export async function bestSuite(): Promise<Suite> {
  try {
    await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"]);
    return "X25519";
  } catch {
    return "P-256";
  }
}

export async function generateIdentity(suite: Suite): Promise<Identity> {
  const pair = (await subtle().generateKey(params(suite), true, [
    "deriveBits"
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return {
    suite,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyHex: hex(raw)
  };
}

async function importPeer(suite: Suite, publicKeyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(publicKeyHex);
  const expected = suite === "X25519" ? 32 : 65;
  if (raw.length !== expected) {
    throw new Error(
      `A ${suite} public key is ${expected} bytes; this one is ${raw.length}. Are both sides on the same suite?`
    );
  }
  return subtle().importKey("raw", buf(raw), params(suite), false, []);
}

/**
 * Derive the root both sides will feed to the key schedule.
 *
 * Note the sort: each side passes its own key and the peer's, in whatever order
 * it holds them, and the transcript comes out identical on both. Without that
 * the two sides would derive different roots and nothing would decrypt.
 */
export async function agree(
  identity: Identity,
  peerPublicKeyHex: string
): Promise<{ root: Uint8Array; transcript: string }> {
  if (peerPublicKeyHex.trim() === identity.publicKeyHex) {
    throw new Error("That is this side's own public key. Paste the other side's.");
  }
  const peer = await importPeer(identity.suite, peerPublicKeyHex);
  const bits = new Uint8Array(
    await subtle().deriveBits(
      identity.suite === "X25519"
        ? { name: "X25519", public: peer }
        : { name: "ECDH", public: peer },
      identity.privateKey,
      256
    )
  );

  const transcript = [identity.publicKeyHex, peerPublicKeyHex.trim().toLowerCase()].sort().join("|");
  const info = new TextEncoder().encode(`crypto-lab-fte/v1/handshake/${identity.suite}/${transcript}`);

  const key = await subtle().importKey("raw", buf(bits), { name: "HKDF" }, false, ["deriveBits"]);
  const root = new Uint8Array(
    await subtle().deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: buf(info) },
      key,
      ROOT_BYTES * 8
    )
  );
  return { root, transcript };
}
