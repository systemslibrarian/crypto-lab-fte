import { describe, expect, it } from "vitest";
import {
  FormatError,
  MIN_USEFUL_CAPACITY_BITS,
  chooseLength,
  compileFormat,
  decode,
  encode,
  frameByteFalseAccept,
  payloadBitsFor
} from "./fte.ts";
import { DfaTooLargeError } from "./regex/dfa.ts";
import { hexToBytes } from "./ff1.ts";

const SALT = hexToBytes("000102030405060708090a0b0c0d0e0f");

// 600k PBKDF2 iterations run twice per round trip; give the slow cases room.
const SLOW = 60_000;

describe("format compilation", () => {
  it("compiles each preset and reports its capacity", () => {
    const phone = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    expect(phone.shortestN).toBe(14);
    expect(phone.counts[14]).toBe(10n ** 10n);
    expect(phone.maxCapacityBits).toBe(33);

    const hex = compileFormat("[0-9a-f]{32}");
    expect(hex.counts[32]).toBe(16n ** 32n);
    expect(hex.maxCapacityBits).toBe(128);

    const b64 = compileFormat("[A-Za-z0-9+/]{64}");
    expect(b64.counts[64]).toBe(64n ** 64n);
    expect(b64.maxCapacityBits).toBe(384);

    const ip = compileFormat("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    expect(ip.shortestN).toBe(7); // 1.1.1.1
    expect(ip.maxCapacityBits).toBe(39); // 1000^4 at n = 15
    expect(ip.maxCapacityN).toBe(15);
  });

  it("rejects a pattern with under 8 bits of capacity at every length", () => {
    expect(() => compileFormat("abc")).toThrow(FormatError);
    expect(() => compileFormat("(yes|no)")).toThrow(
      new RegExp(`${MIN_USEFUL_CAPACITY_BITS}-bit floor`)
    );
  });

  it("rejects a pattern whose DFA blows past 4096 states", () => {
    expect(() => compileFormat("[ab]*a[ab]{20}")).toThrow(DfaTooLargeError);
  });
});

describe("encode / decode round trip", () => {
  it(
    "recovers the message through a phone number",
    async () => {
      const format = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
      const result = await encode({
        format,
        n: 14,
        message: "hi",
        passphrase: "correct horse battery staple",
        salt: SALT
      });
      expect(result.stego).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      expect(result.n).toBe(14);
      expect(result.payloadBits).toBe(payloadBitsFor(2));

      const back = await decode({
        format,
        stego: result.stego,
        passphrase: "correct horse battery staple",
        salt: SALT
      });
      expect(back.message).toBe("hi");
    },
    SLOW
  );

  it(
    "recovers a longer message through a base64 block",
    async () => {
      const format = compileFormat("[A-Za-z0-9+/]{64}");
      const message = "Meet me where the DFA accepts. — 集合 𝄞";
      const result = await encode({
        format,
        n: 64,
        message,
        passphrase: "pw",
        salt: SALT
      });
      expect(result.stego).toMatch(/^[A-Za-z0-9+/]{64}$/);
      const back = await decode({ format, stego: result.stego, passphrase: "pw", salt: SALT });
      expect(back.message).toBe(message);
    },
    SLOW
  );

  it(
    "grows n when the message does not fit the requested length",
    async () => {
      const format = compileFormat("[0-9a-f]{1,512}");
      // 6 UTF-8 bytes + frame = 56 bits; each hex char is 4 bits, so n = 14.
      const result = await encode({
        format,
        n: 4,
        message: "abcdef",
        passphrase: "pw",
        salt: SALT
      });
      expect(result.requestedN).toBe(4);
      expect(result.n).toBe(14);
      expect(result.stego).toHaveLength(14);
      const back = await decode({ format, stego: result.stego, passphrase: "pw", salt: SALT });
      expect(back.message).toBe("abcdef");
    },
    SLOW
  );

  it(
    "fails closed on the wrong passphrase or the wrong salt",
    async () => {
      const format = compileFormat("[A-Za-z0-9+/]{64}");
      const result = await encode({
        format,
        n: 64,
        message: "the message",
        passphrase: "right",
        salt: SALT
      });
      await expect(
        decode({ format, stego: result.stego, passphrase: "wrong", salt: SALT })
      ).rejects.toThrow(FormatError);
      await expect(
        decode({
          format,
          stego: result.stego,
          passphrase: "right",
          salt: hexToBytes("0f0e0d0c0b0a09080706050403020100")
        })
      ).rejects.toThrow(FormatError);
    },
    SLOW
  );

  it(
    "produces a different stego string for the same message under a different salt",
    async () => {
      const format = compileFormat("[0-9a-f]{32}");
      const a = await encode({ format, n: 32, message: "same", passphrase: "pw", salt: SALT });
      const b = await encode({
        format,
        n: 32,
        message: "same",
        passphrase: "pw",
        salt: hexToBytes("ffeeddccbbaa99887766554433221100")
      });
      expect(a.stego).not.toBe(b.stego);
    },
    SLOW
  );

  it(
    "the stego string really is a member of the language, checked by the platform engine",
    async () => {
      const patterns = ["\\(\\d{3}\\) \\d{3}-\\d{4}", "[0-9a-f]{32}", "[A-Za-z0-9+/]{64}"];
      for (const pattern of patterns) {
        const format = compileFormat(pattern);
        const n = format.maxCapacityN;
        const result = await encode({ format, n, message: "x", passphrase: "pw", salt: SALT });
        expect(new RegExp(`^(?:${pattern})$`).test(result.stego), pattern).toBe(true);
      }
    },
    SLOW
  );
});

describe("the frame byte is not authentication", () => {
  it("false-accepts a wrong key at a rate set by the domain, not by 1/256", () => {
    const phone = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const ipv4 = compileFormat("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    const hex = compileFormat("[0-9a-f]{32}");
    const b64 = compileFormat("[A-Za-z0-9+/]{64}");

    // The phone slice is 10^10, and the whole of [2^32, 2^33) — 4.29e9 of the
    // 1e10 values — has leading byte 0x01. That is 110x worse than 1/255.
    expect(frameByteFalseAccept(phone.counts[14])).toBeCloseTo(0.4312, 3);
    expect(frameByteFalseAccept(ipv4.counts[15])).toBeCloseTo(0.0043, 3);
    expect(frameByteFalseAccept(hex.counts[32])).toBeCloseTo(0.0039, 3);
    // Both hex and base64 have N an exact power of 256 (2^128 and 2^384), and
    // for those the intuition IS right: the rate collapses to 1/255. That is
    // the coincidence that makes "1 in 256" sound true — it holds for exactly
    // the formats whose slice happens to be byte-aligned, and for no others.
    expect(frameByteFalseAccept(b64.counts[64])).toBeCloseTo(1 / 255, 5);
    expect(frameByteFalseAccept(hex.counts[32])).toBeCloseTo(1 / 255, 5);

    // The page and the README both quote these. The claim under test is not any
    // one of them but the spread: a check whose strength swings by four orders
    // of magnitude with the format is not an integrity check.
    expect(frameByteFalseAccept(phone.counts[14])).toBeGreaterThan(
      100 * frameByteFalseAccept(hex.counts[32])
    );
  });

  it("a wrong passphrase never recovers the message, whether or not it is rejected", async () => {
    const format = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const result = await encode({
      format,
      n: 14,
      message: "hi",
      passphrase: "right",
      salt: SALT
    });

    // The tempting assertion — "every wrong passphrase throws" — is NOT a
    // property of this construction, and writing it would be the same mistake
    // the frame byte itself invites. With N = 10^10 the frame byte admits ~43%
    // of wrong keys and the strict UTF-8 decode catches most, not all, of those,
    // so about one wrong passphrase in thirty returns four bytes of garbage
    // instead of an error. That is the No authentication limitation, working
    // exactly as documented.
    //
    // What IS guaranteed is confidentiality: a wrong key never yields the
    // plaintext. So assert that, and separately record that the rejection path
    // is genuinely exercised rather than vacuous.
    let rejected = 0;
    let accepted = 0;
    for (let i = 0; i < 12; i += 1) {
      try {
        const out = await decode({
          format,
          stego: result.stego,
          passphrase: `wrong-${i}`,
          salt: SALT
        });
        accepted += 1;
        expect(out.message).not.toBe("hi");
      } catch (error) {
        expect(error).toBeInstanceOf(FormatError);
        rejected += 1;
      }
    }
    expect(rejected + accepted).toBe(12);
    // Fixed salt and fixed passphrases make this deterministic, so this is a
    // real observation and not a coin flip: the rejection path fires for the
    // large majority, which is what the limitation text on the page claims.
    expect(rejected).toBeGreaterThanOrEqual(8);
  }, SLOW);
});

describe("length selection", () => {
  it("keeps the requested n when the payload fits, and names the ceiling when it cannot", () => {
    const format = compileFormat("[0-9a-f]{1,512}");
    expect(chooseLength(format, 32, 128)).toBe(32);
    expect(chooseLength(format, 4, 128)).toBe(32);
    expect(() => chooseLength(format, 4, 10_000)).toThrow(/tops out at/);
  });
});

describe("the cycle walk is recorded, not just counted", () => {
  it("the landings end at the enciphered value and match the step count", async () => {
    const format = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const result = await encode({
      format,
      n: 14,
      message: "hi",
      passphrase: "pw",
      salt: new Uint8Array(16).fill(7)
    });
    const { walkLandings, walkSteps, ciphered, domain } = result.trace;
    expect(walkLandings).toHaveLength(walkSteps);
    expect(walkLandings[walkLandings.length - 1]).toBe(ciphered);
    // Every landing before the last missed the domain; the last one is inside.
    for (const landing of walkLandings.slice(0, -1)) {
      expect(landing >= domain).toBe(true);
    }
    expect(ciphered < domain).toBe(true);
    // And every landing is inside the binary domain FF1 actually permutes.
    const ceiling = 1n << BigInt(result.trace.walkBits);
    for (const landing of walkLandings) expect(landing < ceiling).toBe(true);
  });
});
