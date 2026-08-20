import { describe, expect, it } from "vitest";
import {
  Rng,
  buildRound,
  cryptoRng,
  ipv4Tells,
  phoneTells,
  realismFor,
  scoreRound,
  tellsFor
} from "./decoys.ts";

/** Deterministic stand-in for the CSPRNG, so rounds are reproducible in tests. */
function seeded(seed: number): Rng {
  let x = seed >>> 0;
  return (bound: number) => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return bound <= 0 ? 0 : x % bound;
  };
}

describe("realistic decoys", () => {
  it("only claims a corpus where one exists, and explains itself otherwise", () => {
    expect("make" in realismFor("phone")).toBe(true);
    expect("make" in realismFor("ipv4")).toBe(true);
    const hex = realismFor("hex");
    expect("why" in hex && hex.why).toContain("no such thing as a realistic random hex");
    const custom = realismFor("something-else");
    expect("why" in custom).toBe(true);
  });

  it("every realistic phone number satisfies NANP assignment rules", () => {
    const realism = realismFor("phone");
    if (!("make" in realism)) throw new Error("phone must have a corpus");
    const rng = seeded(7);
    for (let i = 0; i < 400; i += 1) {
      const value = realism.make(rng);
      expect(value).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      // The tells function is the same judge the reveal uses; a realistic
      // number must give it nothing to say.
      expect(phoneTells(value)).toEqual([]);
    }
  });

  it("every realistic dotted quad is one a log would actually contain", () => {
    const realism = realismFor("ipv4");
    if (!("make" in realism)) throw new Error("ipv4 must have a corpus");
    const rng = seeded(99);
    for (let i = 0; i < 400; i += 1) {
      const value = realism.make(rng);
      expect(value).toMatch(/^\d{3}\.\d{3}\.\d{3}\.\d{3}$/);
      expect(ipv4Tells(value)).toEqual([]);
    }
  });

  it("names the tell in the uniform draws a human could actually catch", () => {
    expect(phoneTells("(012) 345-6789")).toContain("area code 012 starts with 0 — never assigned");
    expect(phoneTells("(911) 345-6789")).toContain("911 is an N11 service code");
    expect(phoneTells("(415) 555-6789")).toContain("555 is reserved for fiction");
    expect(phoneTells("(415) 105-6789")).toContain("exchange 105 starts with 1 — never assigned");
    expect(ipv4Tells("000.001.002.003")).toContain("first octet 000 — not a routable source");
    expect(ipv4Tells("192.168.001.255")).toContain("host octet 255 is a network or broadcast address");
  });

  it("mixes the requested counts and shuffles them", () => {
    const generated = ["(012) 345-6789", "(111) 222-3333", "(019) 000-0001"];
    const round = buildRound("phone", generated, 3, seeded(3));
    expect(round.candidates).toHaveLength(6);
    expect(round.generatedCount).toBe(3);
    expect(round.candidates.filter((c) => !c.generated)).toHaveLength(3);
    // Not left in generated-first order.
    const order = round.candidates.map((c) => c.generated);
    expect(order).not.toEqual([true, true, true, false, false, false]);
  });

  it("declines to build a round where no corpus is defensible", () => {
    const round = buildRound("hex", ["deadbeef"], 3, seeded(1));
    expect(round.candidates).toEqual([]);
    expect(round.generatedCount).toBe(0);
  });

  it("admits when a uniform draw carries no tell at all", () => {
    // (415) 267-4432 is a perfectly plausible number that a uniform draw can
    // produce. The game must not pretend otherwise.
    const round = buildRound("phone", ["(415) 267-4432"], 0, seeded(5));
    const generated = round.candidates.find((c) => c.generated);
    expect(generated?.tell).toContain("no obvious tell");
  });

  it("scores a pick set, and reports which generated strings got through", () => {
    const round = buildRound("phone", ["(012) 345-6789", "(019) 000-0001"], 2, seeded(11));
    const allGenerated = new Set(round.candidates.filter((c) => c.generated).map((c) => c.value));
    const perfect = scoreRound(round, allGenerated);
    expect(perfect.correct).toBe(round.candidates.length);
    expect(perfect.missed).toEqual([]);

    const nothing = scoreRound(round, new Set());
    expect(nothing.correct).toBe(round.candidates.length - round.generatedCount);
    expect(nothing.missed).toHaveLength(round.generatedCount);
  });

  it("never emits a duplicate candidate", () => {
    const round = buildRound("phone", ["(012) 345-6789"], 5, seeded(21));
    const values = round.candidates.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("tellsFor is silent on presets with no corpus", () => {
    expect(tellsFor("hex", "deadbeef")).toEqual([]);
  });

  it("cryptoRng stays inside its bound", () => {
    for (const bound of [1, 2, 7, 800, 10000]) {
      for (let i = 0; i < 50; i += 1) {
        const value = cryptoRng(bound);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }
    }
    expect(cryptoRng(0)).toBe(0);
  });
});
