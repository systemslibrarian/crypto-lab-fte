import { describe, expect, it } from "vitest";
import {
  bigIntToMinimalBytesBE,
  bytesToBigIntBE,
  cycleWalkDecrypt,
  cycleWalkEncrypt,
  ff1Decrypt,
  ff1Encrypt,
  hexToBytes,
  importFf1Key,
  walkWidth
} from "./ff1.ts";
import { FF1_VECTORS, runAllVectors, runVector, tally } from "./vectors.ts";

/**
 * The nine sample vectors published by NIST alongside SP 800-38G. They pin the
 * exact ciphertext for AES-128/192/256 at radix 10 and 36, so any regression in
 * the round function, the P block, the Q padding or the split fails the build.
 *
 * The list itself lives in `src/vectors.ts` because the Sources panel runs the
 * same nine in the browser. One definition, so a vector cannot be quietly
 * adjusted here to make a red test green while the page keeps claiming NIST.
 */
describe("FF1 known-answer tests (NIST SP 800-38G sample vectors)", () => {
  for (const vector of FF1_VECTORS) {
    it(`${vector.name} — AES-${vector.keyBits}, radix ${vector.radix}${vector.tweakHex ? ", tweaked" : ", no tweak"}`, async () => {
      const run = await runVector(vector);
      expect(run.actual).toBe(vector.expected);
      expect(run.roundTrip).toBe(vector.plaintext);
      expect(run.pass).toBe(true);
    });
  }
});

describe("FF1 at radix 2 — the mode this lab uses", () => {
  it("permutes {0,1}^k and inverts", async () => {
    const key = await importFf1Key(hexToBytes("00112233445566778899aabbccddeeff"));
    const tweak = hexToBytes("0a0b0c0d");
    for (const k of [20, 33, 64, 128]) {
      const bits = new Uint8Array(k);
      for (let i = 0; i < k; i += 1) bits[i] = (i * 7 + 3) % 2;
      const ct = await ff1Encrypt(key, 2, bits, tweak);
      expect(ct.length).toBe(k);
      expect(Array.from(ct).every((b) => b === 0 || b === 1)).toBe(true);
      expect(Array.from(await ff1Decrypt(key, 2, ct, tweak))).toEqual(Array.from(bits));
    }
  });

  it("is a permutation, not a mapping with collisions", async () => {
    const key = await importFf1Key(hexToBytes("0f1e2d3c4b5a69788796a5b4c3d2e1f0"));
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const bits = new Uint8Array(20);
      for (let b = 0; b < 20; b += 1) bits[b] = (i >> (b % 6)) & 1;
      const ct = await ff1Encrypt(key, 2, bits, new Uint8Array());
      seen.add(ct.join(""));
    }
    // 64 distinct inputs (the six low bits of i, tiled), so 64 distinct outputs.
    expect(seen.size).toBe(64);
  });
});

describe("cycle walking onto a non-power-of-two domain", () => {
  const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

  it("round-trips every value it is given, and never leaves the domain", async () => {
    const key = await importFf1Key(hexToBytes(KEY));
    const tweak = hexToBytes("deadbeefdeadbeefdeadbeefdeadbeef");
    // 3^13 = 1,594,323 — over the 10^6 floor and comfortably not a power of two.
    const domain = 1_594_323n;
    for (const value of [0n, 1n, 12345n, domain - 1n, domain / 2n]) {
      const enc = await cycleWalkEncrypt(key, domain, value, tweak);
      expect(enc.value).toBeGreaterThanOrEqual(0n);
      expect(enc.value).toBeLessThan(domain);
      expect(enc.steps).toBeGreaterThanOrEqual(1);
      const dec = await cycleWalkDecrypt(key, domain, enc.value, tweak);
      expect(dec.value).toBe(value);
    }
  });

  it("is injective on the domain, which is what makes it decodable", async () => {
    const key = await importFf1Key(hexToBytes(KEY));
    const domain = 1_048_583n; // a prime just over 2^20
    const seen = new Map<string, bigint>();
    for (let v = 0n; v < 200n; v += 1n) {
      const { value } = await cycleWalkEncrypt(key, domain, v, new Uint8Array());
      expect(value).toBeLessThan(domain);
      expect(seen.has(value.toString())).toBe(false);
      seen.set(value.toString(), v);
    }
  });

  it("refuses a domain under the SP 800-38G Rev. 1 floor of 10^6", async () => {
    const key = await importFf1Key(hexToBytes(KEY));
    await expect(cycleWalkEncrypt(key, 1000n, 7n, new Uint8Array())).rejects.toThrow(
      /1,000,000/
    );
  });

  it("walkWidth is the smallest k with N ≤ 2^k", () => {
    expect(walkWidth(2n)).toBe(1);
    expect(walkWidth(1024n)).toBe(10);
    expect(walkWidth(1025n)).toBe(11);
    expect(walkWidth((1n << 384n) - 1n)).toBe(384);
  });
});

describe("big-endian helpers", () => {
  it("minimal encoding is the exact inverse of the integer read", () => {
    for (const hex of ["01", "01ff", "0100", "01000000", "017f80ff00"]) {
      const bytes = hexToBytes(hex);
      expect(Array.from(bigIntToMinimalBytesBE(bytesToBigIntBE(bytes)))).toEqual(
        Array.from(bytes)
      );
    }
  });
});

describe("the in-page vector runner", () => {
  it("reports a status and a note for every vector, not just a boolean", async () => {
    for (const vector of FF1_VECTORS) {
      const run = await runVector(vector);
      expect(["pass", "fail", "unsupported"]).toContain(run.status);
      expect(run.note.length).toBeGreaterThan(0);
      expect(run.pass).toBe(run.status === "pass");
    }
  });

  /**
   * Node's WebCrypto DOES implement AES-192, so all nine run here. A browser
   * has no AES-192 at all and marks samples 4-6 unsupported — which is exactly
   * the asymmetry the in-page runner exists to make visible, and the reason
   * this suite alone cannot vouch for what a visitor sees.
   */
  it("runs all nine under Node, where AES-192 is available", async () => {
    const runs = await runAllVectors();
    const counts = tally(runs);
    expect(counts.total).toBe(9);
    expect(counts.failed).toBe(0);
    expect(counts.passed + counts.unsupported).toBe(9);
  });

  it("never reports an unsupported vector as a failure", async () => {
    const runs = await runAllVectors();
    for (const run of runs.filter((r) => r.status === "unsupported")) {
      expect(run.pass).toBe(false);
      expect(run.actual).toBe("");
      expect(run.note).toContain("AES-192");
    }
  });
});
