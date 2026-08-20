import { describe, expect, it } from "vitest";
import { compileFormat, encode, frameByteFalseAccept, prepareDecode } from "./fte.ts";
import { buildCountTable } from "./rank.ts";
import { classifyFailure, runSubstitutions } from "./substitute.ts";

const PHONE = "\\(\\d{3}\\) \\d{3}-\\d{4}";
const SALT = new Uint8Array(16).fill(9);

/** Deterministic adversary, so a run is reproducible. */
function seeded(seed: number): (bound: bigint) => bigint {
  let x = BigInt(seed);
  return (bound: bigint) => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return x % bound;
  };
}

describe("substituting a different member of the language", () => {
  it("classifies a refusal by which of the two checks caught it", () => {
    expect(classifyFailure("Decode failed: the recovered bytes have no frame marker. …")).toBe(
      "rejected-frame"
    );
    expect(classifyFailure("Decode failed: the recovered bytes are not valid UTF-8. …")).toBe(
      "rejected-utf8"
    );
  });

  it("never returns the original message, whatever the outcome", async () => {
    const format = compileFormat(PHONE);
    const message = "hi";
    const result = await encode({ format, n: 14, message, passphrase: "pw", salt: SALT });
    const table = buildCountTable(format.dfa, 14);
    const prepared = await prepareDecode("pw", SALT);

    const report = await runSubstitutions(format, table, prepared, result.stego, 40, seeded(1));
    expect(report.trials).toHaveLength(40);
    for (const trial of report.trials) {
      expect(trial.stego).not.toBe(result.stego);
      // THE claim of the third limitation: substitution never recovers the
      // real message. It may return garbage; it never returns "hi".
      expect(trial.message).not.toBe(message);
    }
  });

  it("every trial is a genuine member of the language", async () => {
    const format = compileFormat(PHONE);
    const result = await encode({ format, n: 14, message: "hi", passphrase: "pw", salt: SALT });
    const table = buildCountTable(format.dfa, 14);
    const prepared = await prepareDecode("pw", SALT);
    const report = await runSubstitutions(format, table, prepared, result.stego, 25, seeded(2));
    const anchored = new RegExp(`^(?:${PHONE})$`);
    for (const trial of report.trials) expect(anchored.test(trial.stego)).toBe(true);
  });

  it("the counts partition the trials exactly", async () => {
    const format = compileFormat(PHONE);
    const result = await encode({ format, n: 14, message: "hi", passphrase: "pw", salt: SALT });
    const table = buildCountTable(format.dfa, 14);
    const prepared = await prepareDecode("pw", SALT);
    const report = await runSubstitutions(format, table, prepared, result.stego, 30, seeded(3));
    expect(report.accepted + report.rejectedFrame + report.rejectedUtf8).toBe(report.trials.length);
    expect(report.measuredRate).toBeCloseTo(report.accepted / report.trials.length, 10);
  });

  /**
   * The cross-check that makes the panel worth showing: the share of trials
   * getting PAST THE FRAME BYTE must track `frameByteFalseAccept`, which counts
   * intervals of [0, N) and never runs the cipher. Two independent routes.
   *
   * The tolerance is wide because 120 Bernoulli trials at p = 0.43 have a
   * standard error near 4.5 points; this is checking the order of magnitude and
   * that the folklore 1/256 is nowhere near it, not a tight fit.
   */
  it("the measured pass-the-frame-byte rate tracks the closed-form prediction", async () => {
    const format = compileFormat(PHONE);
    const result = await encode({ format, n: 14, message: "hi", passphrase: "pw", salt: SALT });
    const table = buildCountTable(format.dfa, 14);
    const prepared = await prepareDecode("pw", SALT);
    const report = await runSubstitutions(format, table, prepared, result.stego, 120, seeded(4));

    const pastFrame = report.accepted + report.rejectedUtf8;
    const measured = pastFrame / report.trials.length;
    const predicted = frameByteFalseAccept(table.total);
    expect(predicted).toBeCloseTo(0.4312, 3);
    expect(Math.abs(measured - predicted)).toBeLessThan(0.16);
    // And nowhere near the folklore figure.
    expect(measured).toBeGreaterThan(10 / 256);
  });

  it("asking for more trials than the language has members still terminates", async () => {
    // A tiny-but-legal slice: 10^6 is the FF1 domain floor, and \\d{6} is exactly it.
    const format = compileFormat("\\d{6}");
    const result = await encode({ format, n: 6, message: "a", passphrase: "pw", salt: SALT });
    const table = buildCountTable(format.dfa, 6);
    const prepared = await prepareDecode("pw", SALT);
    const report = await runSubstitutions(format, table, prepared, result.stego, 8, seeded(5));
    expect(report.trials.length).toBeGreaterThan(0);
    expect(report.trials.length).toBeLessThanOrEqual(8);
  });
});
