import { describe, expect, it } from "vitest";
import { buildDfa } from "./regex/dfa.ts";
import { buildNfa } from "./regex/nfa.ts";
import { parseRegex } from "./regex/parser.ts";
import { buildCountTable, rank, unrank } from "./rank.ts";
import { pathEdges, tracePath } from "./pathtrace.ts";

function compile(pattern: string) {
  return buildDfa(buildNfa(parseRegex(pattern)));
}

describe("path tracing through the automaton", () => {
  it("visits one more state than the string has characters", () => {
    const dfa = compile("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const path = tracePath(dfa, "(905) 263-5403");
    expect(path.accepted).toBe(true);
    expect(path.failedAt).toBeNull();
    expect(path.states).toHaveLength(15);
    expect(path.steps).toHaveLength(14);
    expect(path.states[0]).toBe(dfa.start);
  });

  it("each step starts where the previous one ended", () => {
    const dfa = compile("[0-9a-f]{8}");
    const path = tracePath(dfa, "deadbeef");
    for (let i = 0; i < path.steps.length; i += 1) {
      expect(path.steps[i].from).toBe(path.states[i]);
      expect(path.steps[i].to).toBe(path.states[i + 1]);
      expect(path.steps[i].index).toBe(i);
    }
  });

  /**
   * The claim that makes the highlighted drawing trustworthy: the path shown is
   * the path the ranking arithmetic actually took. If these ever diverged, the
   * page would be drawing a route the encoder did not use.
   */
  it("agrees with rank/unrank over the whole language slice", () => {
    const dfa = compile("(ab|cd){2}");
    const table = buildCountTable(dfa, 4);
    for (let i = 0n; i < table.total; i += 1n) {
      const text = unrank(dfa, table, i);
      const path = tracePath(dfa, text);
      expect(path.accepted).toBe(true);
      expect(rank(dfa, table, text)).toBe(i);
      expect(path.states).toHaveLength(text.length + 1);
      expect(dfa.accepting[path.states[path.states.length - 1]]).toBe(true);
    }
  });

  it("reports the exact character that leaves the language", () => {
    const dfa = compile("\\d{4}");
    const path = tracePath(dfa, "12x4");
    expect(path.accepted).toBe(false);
    expect(path.failedAt).toBe(2);
    expect(path.steps).toHaveLength(2);
  });

  it("a prefix of an accepted string is not accepted, and says so without failing", () => {
    const dfa = compile("\\d{4}");
    const path = tracePath(dfa, "123");
    expect(path.accepted).toBe(false);
    expect(path.failedAt).toBeNull();
    expect(path.steps).toHaveLength(3);
  });

  it("the empty string traces to the start state alone", () => {
    const dfa = compile("\\d*");
    const path = tracePath(dfa, "");
    expect(path.states).toEqual([dfa.start]);
    expect(path.steps).toEqual([]);
    expect(path.accepted).toBe(true);
  });

  it("collapses repeated transitions into the distinct edges to highlight", () => {
    const dfa = compile("[0-9a-f]{8}");
    const path = tracePath(dfa, "deadbeef");
    const edges = pathEdges(path);
    expect(edges.size).toBeLessThanOrEqual(path.steps.length);
    for (const step of path.steps) {
      expect(edges.has(`${step.from}->${step.to}`)).toBe(true);
    }
  });

  it("a self-looping pattern reuses one edge for every character", () => {
    const dfa = compile("\\d+");
    const path = tracePath(dfa, "5555555");
    expect(path.accepted).toBe(true);
    // Start → digit state, then the digit state loops: two distinct edges at most.
    expect(pathEdges(path).size).toBeLessThanOrEqual(2);
  });
});
