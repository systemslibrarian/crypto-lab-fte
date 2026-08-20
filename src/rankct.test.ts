import { describe, expect, it } from "vitest";
import { buildDfa } from "./regex/dfa.ts";
import { buildNfa } from "./regex/nfa.ts";
import { parseRegex } from "./regex/parser.ts";
import { NotInLanguageError, buildCountTable, rank, unrank } from "./rank.ts";
import { rankFixed, unrankFixed } from "./rankct.ts";

function compile(pattern: string) {
  return buildDfa(buildNfa(parseRegex(pattern)));
}

/**
 * The branchless versions are only worth having if they are the SAME
 * bijection. These walk entire language slices and compare against `rank.ts`
 * index by index — if the arithmetic select ever picked a different run, the
 * enumeration order would drift and this would catch it immediately.
 */
describe("branchless ranking agrees with the branching original", () => {
  for (const pattern of ["(ab|cd){2}", "\\d{4}", "[a-c]{3}", "(a|bb)(c|dd)"]) {
    it(`enumerates /${pattern}/ identically, over the whole slice`, () => {
      const dfa = compile(pattern);
      for (const n of [2, 3, 4, 5, 6]) {
        const table = buildCountTable(dfa, n);
        if (table.total === 0n) continue;
        for (let i = 0n; i < table.total; i += 1n) {
          const a = unrank(dfa, table, i);
          const b = unrankFixed(dfa, table, i);
          expect(b, `unrank mismatch at ${i} for n=${n}`).toBe(a);
          expect(rankFixed(dfa, table, b), `rank mismatch on "${b}"`).toBe(i);
          expect(rank(dfa, table, b)).toBe(i);
        }
      }
    });
  }

  it("round-trips a wide slice without enumerating all of it", () => {
    const dfa = compile("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const table = buildCountTable(dfa, 14);
    for (const i of [0n, 1n, 999n, 4155550123n, table.total - 1n]) {
      const text = unrankFixed(dfa, table, i);
      expect(text).toBe(unrank(dfa, table, i));
      expect(rankFixed(dfa, table, text)).toBe(i);
    }
  });

  it("rejects the same strings the original rejects, with the same error type", () => {
    const dfa = compile("\\d{4}");
    const table = buildCountTable(dfa, 4);
    for (const bad of ["12x4", "abcd", "123", "12345"]) {
      expect(() => rankFixed(dfa, table, bad)).toThrow(NotInLanguageError);
      expect(() => rank(dfa, table, bad)).toThrow(NotInLanguageError);
    }
  });

  it("refuses an out-of-range index exactly as the original does", () => {
    const dfa = compile("\\d{4}");
    const table = buildCountTable(dfa, 4);
    expect(() => unrankFixed(dfa, table, -1n)).toThrow(RangeError);
    expect(() => unrankFixed(dfa, table, table.total)).toThrow(RangeError);
  });

  /**
   * The property that motivates the whole file: the number of run iterations is
   * a function of the DFA and n only, never of the index. Counted here by
   * instrumenting `runs` with a Proxy, so it measures the real loop rather than
   * a re-derivation of it.
   */
  it("does the same amount of work whatever the secret index is", () => {
    // `(ab|cd){2}`, not `[a-c]{4}`: the latter collapses to ONE alphabet class,
    // so the original breaks on the first run every time and would not vary
    // either — the control half of this test would pass for the wrong reason.
    // Here 'a' and 'c' lead to different states, so they are different runs and
    // the index genuinely decides how far the original loop walks.
    const dfa = compile("(ab|cd){2}");
    const table = buildCountTable(dfa, 4);

    const count = (fn: () => void): number => {
      let iterations = 0;
      const original = dfa.runs;
      const watched = new Proxy(original, {
        get(target, prop, receiver) {
          if (prop === Symbol.iterator) {
            return function* () {
              for (const run of target) {
                iterations += 1;
                yield run;
              }
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      (dfa as { runs: typeof original }).runs = watched;
      try {
        fn();
      } finally {
        (dfa as { runs: typeof original }).runs = original;
      }
      return iterations;
    };

    const counts = new Set<number>();
    for (let i = 0n; i < table.total; i += 1n) {
      counts.add(count(() => void unrankFixed(dfa, table, i)));
    }
    expect(counts.size, `iteration counts varied: ${[...counts].join(", ")}`).toBe(1);

    // And the original DOES vary — otherwise this test proves nothing.
    const originalCounts = new Set<number>();
    for (let i = 0n; i < table.total; i += 1n) {
      originalCounts.add(count(() => void unrank(dfa, table, i)));
    }
    expect(originalCounts.size).toBeGreaterThan(1);
  });
});
