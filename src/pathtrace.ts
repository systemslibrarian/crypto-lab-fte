/**
 * The path a particular string walks through the automaton.
 *
 * The page draws a minimized DFA and, separately, prints a string that DFA
 * accepts. Until now the two never acknowledged each other, which wasted the
 * best pairing on the page: the graph is not an illustration of automata theory
 * in general, it is the thing that produced this exact phone number.
 *
 * This is deliberately a re-walk rather than instrumentation of `rank`. Ranking
 * is arithmetic in the hot path and belongs to `rank.ts`; asking it to also emit
 * a trace would put display concerns inside the counting DP. Walking `delta`
 * again is O(n) and cannot disagree with `rank`, because both consult the same
 * transition table — and `pathtrace.test.ts` pins that agreement.
 */

import { Dfa, stepSymbol } from "./regex/dfa.ts";

export interface PathStep {
  /** Index of the character consumed, 0-based. */
  index: number;
  char: string;
  from: number;
  to: number;
}

export interface Path {
  /** States visited, length = string length + 1, starting at dfa.start. */
  states: number[];
  steps: PathStep[];
  /** False when the string leaves the language partway or ends non-accepting. */
  accepted: boolean;
  /** Set when rejected: the character index that broke it. */
  failedAt: number | null;
}

export function tracePath(dfa: Dfa, text: string): Path {
  const chars = Array.from(text);
  const states: number[] = [dfa.start];
  const steps: PathStep[] = [];
  let q = dfa.start;

  for (let i = 0; i < chars.length; i += 1) {
    const code = chars[i].codePointAt(0) as number;
    const t = stepSymbol(dfa, q, code);
    if (t < 0) {
      return { states, steps, accepted: false, failedAt: i };
    }
    steps.push({ index: i, char: chars[i], from: q, to: t });
    states.push(t);
    q = t;
  }

  return { states, steps, accepted: Boolean(dfa.accepting[q]), failedAt: null };
}

/** The distinct directed edges the path uses, for highlighting the drawing. */
export function pathEdges(path: Path): Set<string> {
  return new Set(path.steps.map((s) => `${s.from}->${s.to}`));
}
