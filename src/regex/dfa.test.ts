import { describe, expect, it } from "vitest";
import { parseRegex, RegexError } from "./parser.ts";
import { buildNfa } from "./nfa.ts";
import { DfaTooLargeError, buildDfa, runsCoverSigma, stepSymbol } from "./dfa.ts";
import { SIGMA_SIZE, complementInSigma, setSize } from "./alphabet.ts";

function compile(pattern: string) {
  return buildDfa(buildNfa(parseRegex(pattern)));
}

/** A deliberately naive matcher: walk the DFA symbol by symbol. */
function accepts(pattern: string, text: string): boolean {
  const dfa = compile(pattern);
  let q = dfa.start;
  for (const ch of text) {
    q = stepSymbol(dfa, q, ch.codePointAt(0) as number);
    if (q < 0) return false;
  }
  return dfa.accepting[q];
}

describe("parser", () => {
  it("rejects constructs outside the subset by name", () => {
    expect(() => parseRegex("a(?=b)")).toThrow(RegexError);
    expect(() => parseRegex("\\d{2,}")).toThrow(/Open-ended/);
    expect(() => parseRegex("\\d{1,600}")).toThrow(/exceeds the maximum/);
    expect(() => parseRegex("(ab")).toThrow(/Unclosed/);
    expect(() => parseRegex("[a-")).toThrow(/Unclosed/);
    expect(() => parseRegex("*a")).toThrow(/nothing to repeat/);
    expect(() => parseRegex("[z-a]")).toThrow(/reversed/);
    expect(() => parseRegex("\\q")).toThrow(/not in this lab's subset/);
    // Backreferences get their own message: they are not a missing feature, they
    // are outside the class of languages this construction can count at all.
    expect(() => parseRegex("(a)\\1")).toThrow(/not regular/);
    expect(() => parseRegex("(a)\\1")).toThrow(/Backreference/);
  });

  it("treats anchors as no-ops because matching is always full-string", () => {
    expect(accepts("^abc$", "abc")).toBe(true);
    expect(accepts("^abc$", "abcd")).toBe(false);
  });
});

describe("DFA construction", () => {
  it("matches the language, not a superset of it", () => {
    expect(accepts("\\(\\d{3}\\) \\d{3}-\\d{4}", "(415) 555-0123")).toBe(true);
    expect(accepts("\\(\\d{3}\\) \\d{3}-\\d{4}", "(415) 555-012")).toBe(false);
    expect(accepts("\\(\\d{3}\\) \\d{3}-\\d{4}", "[415] 555-0123")).toBe(false);
    expect(accepts("a|bc", "bc")).toBe(true);
    expect(accepts("a|bc", "ab")).toBe(false);
    expect(accepts("(ab)*", "")).toBe(true);
    expect(accepts("(ab)*", "ababab")).toBe(true);
    expect(accepts("(ab)*", "aba")).toBe(false);
    expect(accepts("x{2,4}", "x")).toBe(false);
    expect(accepts("x{2,4}", "xxx")).toBe(true);
    expect(accepts("x{2,4}", "xxxxx")).toBe(false);
  });

  it("agrees with the platform regex engine on a spread of inputs", () => {
    const cases: Array<[string, string[]]> = [
      ["[0-9a-f]{4}", ["dead", "beef", "DEAD", "dea", "deadb", "zzzz"]],
      ["\\d{1,3}\\.\\d{1,3}", ["1.2", "192.168", "1.", ".1", "1234.5"]],
      ["[^0-9]{3}", ["abc", "a1c", "   ", "ab"]],
      ["(cat|dog)s?", ["cat", "cats", "dog", "dogs", "cad", "cats!"]],
      ["\\w+@\\w+", ["a@b", "user@host", "a@", "@b", "a b@c"]]
    ];
    for (const [pattern, inputs] of cases) {
      const native = new RegExp(`^(?:${pattern})$`);
      for (const text of inputs) {
        expect(accepts(pattern, text), `${pattern} vs ${JSON.stringify(text)}`).toBe(
          native.test(text)
        );
      }
    }
  });

  it("minimizes: two spellings of one language give the same state count", () => {
    expect(compile("(a|b)(a|b)").numStates).toBe(compile("[ab]{2}").numStates);
    expect(compile("aa*").numStates).toBe(compile("a+").numStates);
  });

  it("partitions Σ into classes that cover it exactly once", () => {
    for (const pattern of ["[0-9a-f]{2}", "\\w+", ".{3}", "[^abc]+", "\\s|\\d"]) {
      const dfa = compile(pattern);
      expect(runsCoverSigma(dfa), pattern).toBe(true);
      // Runs are ascending, disjoint and each sits inside one class.
      let last = -1;
      for (const run of dfa.runs) {
        expect(run.lo).toBeGreaterThan(last);
        expect(run.hi).toBeGreaterThanOrEqual(run.lo);
        last = run.hi;
      }
    }
  });

  it("keeps classes coarse: [0-9a-f] needs two, not ninety-seven", () => {
    // The partition is by "which of the pattern's character sets contain me",
    // and [0-9a-f] is ONE set — so 0-9 and a-f share a class even though they
    // are not contiguous. They still rank correctly, because the class is cut
    // into contiguous runs and the walk visits runs in code-point order.
    const dfa = compile("[0-9a-f]{2}");
    expect(dfa.classes.length).toBe(2); // [0-9a-f], and everything else
    expect(dfa.classes.reduce((a, c) => a + c.size, 0)).toBe(SIGMA_SIZE);
    const hexClass = dfa.classes.find((c) => c.set.some((iv) => iv.lo === 0x30));
    const hexRuns = dfa.runs.filter((r) => r.cls === hexClass?.index);
    expect(hexRuns.map((r) => [r.lo, r.hi])).toEqual([
      [0x30, 0x39],
      [0x61, 0x66]
    ]);
  });

  it("refuses a DFA past the state ceiling", () => {
    // Subset construction is exponential on (a|b)*a(a|b){k}: 2^(k+1) states.
    expect(() => compile("[ab]*a[ab]{20}")).toThrow(DfaTooLargeError);
  });
});

describe("alphabet", () => {
  it("complements inside Σ and nowhere else", () => {
    const notDigits = complementInSigma([{ lo: 0x30, hi: 0x39 }]);
    expect(setSize(notDigits)).toBe(SIGMA_SIZE - 10);
    expect(setSize(complementInSigma(notDigits))).toBe(10);
  });
});
