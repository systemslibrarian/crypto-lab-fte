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

const R10 = "0123456789";
const R36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function toSymbols(text: string, alphabet: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (ch) => alphabet.indexOf(ch)));
}
function fromSymbols(symbols: Uint8Array, alphabet: string): string {
  return Array.from(symbols, (s) => alphabet[s]).join("");
}

/**
 * The nine sample vectors published by NIST alongside SP 800-38G. They pin the
 * exact ciphertext for AES-128/192/256 at radix 10 and 36, so any regression in
 * the round function, the P block, the Q padding or the split fails the build.
 */
describe("FF1 known-answer tests (NIST SP 800-38G sample vectors)", () => {
  const K128 = "2b7e151628aed2a6abf7158809cf4f3c";
  const K192 = "2b7e151628aed2a6abf7158809cf4f3cef4359d8d580aa4f";
  const K256 = "2b7e151628aed2a6abf7158809cf4f3cef4359d8d580aa4f7f036d6f04fc6a94";
  const TW = "39383736353433323130";
  const TW36 = "3737373770717273373737";
  const PT10 = "0123456789";
  const PT36 = "0123456789abcdefghi";

  const cases: Array<[string, string, number, string, string, string, string]> = [
    ["S1 AES-128 r10 no tweak", K128, 10, R10, PT10, "", "2433477484"],
    ["S2 AES-128 r10 tweak", K128, 10, R10, PT10, TW, "6124200773"],
    ["S3 AES-128 r36 tweak", K128, 36, R36, PT36, TW36, "a9tv40mll9kdu509eum"],
    ["S4 AES-192 r10 no tweak", K192, 10, R10, PT10, "", "2830668132"],
    ["S5 AES-192 r10 tweak", K192, 10, R10, PT10, TW, "2496655549"],
    ["S6 AES-192 r36 tweak", K192, 36, R36, PT36, TW36, "xbj3kv35jrawxv32ysr"],
    ["S7 AES-256 r10 no tweak", K256, 10, R10, PT10, "", "6657667009"],
    ["S8 AES-256 r10 tweak", K256, 10, R10, PT10, TW, "1001623463"],
    ["S9 AES-256 r36 tweak", K256, 36, R36, PT36, TW36, "xs8a0azh2avyalyzuwd"]
  ];

  for (const [name, keyHex, radix, alphabet, pt, tweakHex, expected] of cases) {
    it(name, async () => {
      const key = await importFf1Key(hexToBytes(keyHex));
      const tweak = hexToBytes(tweakHex);
      const ct = await ff1Encrypt(key, radix, toSymbols(pt, alphabet), tweak);
      expect(fromSymbols(ct, alphabet)).toBe(expected);
      const back = await ff1Decrypt(key, radix, ct, tweak);
      expect(fromSymbols(back, alphabet)).toBe(pt);
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
