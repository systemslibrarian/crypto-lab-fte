import { describe, expect, it } from "vitest";
import { compileFormat, payloadBitsFor } from "./fte.ts";
import { bytesConsistentWith, buildLadder, ladderReadout } from "./lengths.ts";

describe("the length ladder", () => {
  it("chooses the same n the encoder would, for every rung", () => {
    const format = compileFormat("[0-9a-f]{1,64}");
    const ladder = buildLadder(format.counts, 12);
    for (const rung of ladder.rungs) {
      expect(rung.payloadBits).toBe(payloadBitsFor(rung.messageBytes));
      if (rung.n === null) continue;
      // Each hex character is 4 bits, so the smallest n holding b bytes plus
      // the frame byte is ceil(8(b+1)/4) = 2(b+1). Closed form, not the DP.
      expect(rung.n).toBe(2 * (rung.messageBytes + 1));
      expect(rung.capacityBits).toBeGreaterThanOrEqual(rung.payloadBits);
    }
  });

  it("a fixed-length format is one bucket — the wire leaks nothing", () => {
    const format = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const ladder = buildLadder(format.counts, 6);
    const fitting = ladder.rungs.filter((r) => r.n !== null);
    expect(new Set(fitting.map((r) => r.n)).size).toBe(1);
    expect(ladder.buckets).toBe(1);
    expect(ladderReadout(ladder)).toContain("leaks nothing about the message size");
  });

  it("a variable-length format leaks, and the readout says how much", () => {
    const format = compileFormat("[0-9a-f]{1,64}");
    const ladder = buildLadder(format.counts, 12);
    expect(ladder.buckets).toBeGreaterThan(1);
    expect(ladderReadout(ladder)).toContain("distinct wire lengths");
  });

  it("bucket sizes count the rows sharing a wire length", () => {
    const format = compileFormat("[0-9a-f]{1,64}");
    const ladder = buildLadder(format.counts, 12);
    for (const rung of ladder.rungs) {
      if (rung.n === null) continue;
      expect(rung.bucketSize).toBe(bytesConsistentWith(ladder, rung.n).length);
      expect(bytesConsistentWith(ladder, rung.n)).toContain(rung.messageBytes);
    }
  });

  it("names the largest message that fits, and marks the rest unfittable", () => {
    const format = compileFormat("\\(\\d{3}\\) \\d{3}-\\d{4}");
    // 33 bits of capacity: 8(b+1) <= 33 means b <= 3.
    const ladder = buildLadder(format.counts, 8);
    expect(ladder.maxBytes).toBe(3);
    for (const rung of ladder.rungs) {
      if (rung.messageBytes <= 3) expect(rung.n).toBe(14);
      else expect(rung.n).toBeNull();
    }
  });

  /**
   * Counts are passed straight in here rather than through `compileFormat`,
   * which refuses a language this thin at its own 8-bit floor. The ladder still
   * has to cope: it is also fed the counts of a pattern whose chosen n is being
   * dragged around by the reader.
   */
  it("a slice that holds nothing produces an empty ladder and says so", () => {
    const ladder = buildLadder([0n, 0n, 1n, 1n], 6);
    expect(ladder.maxBytes).toBeNull();
    expect(ladder.buckets).toBe(0);
    expect(ladder.rungs.every((r) => r.n === null && r.bucketSize === 0)).toBe(true);
    expect(ladderReadout(ladder)).toContain("no ladder to climb");
  });

  it("an empty counts array does not throw", () => {
    const ladder = buildLadder([], 4);
    expect(ladder.rungs).toHaveLength(4);
    expect(ladder.buckets).toBe(0);
    expect(ladder.maxBytes).toBeNull();
  });

  it("wire length is monotone in message size — the leak has a direction", () => {
    const format = compileFormat("[0-9a-f]{1,64}");
    const fitting = buildLadder(format.counts, 20).rungs.filter((r) => r.n !== null);
    for (let i = 1; i < fitting.length; i += 1) {
      expect(fitting[i].n!).toBeGreaterThanOrEqual(fitting[i - 1].n!);
    }
  });
});
