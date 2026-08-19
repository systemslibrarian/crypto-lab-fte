/**
 * Thompson's construction: AST → ε-NFA.
 *
 * One state per fragment boundary, ε-transitions for control flow, one
 * character-set transition per `char` node. Bounded repetition is expanded
 * (`X{2,4}` becomes `X X X? X?`), which is why the state budget below exists:
 * the expansion is linear in the bound but bounds nest, and `(a{100}){100}`
 * would otherwise try to allocate ten thousand copies before anything downstream
 * had a chance to complain.
 */

import { CharSet } from "./alphabet.ts";
import { Ast, RegexError } from "./parser.ts";

export interface NfaMove {
  set: CharSet;
  to: number;
}

export interface NfaState {
  eps: number[];
  moves: NfaMove[];
}

export interface Nfa {
  states: NfaState[];
  start: number;
  accept: number;
}

/**
 * Expansion budget. The DFA can be at most 4096 states (the lab's stated limit),
 * and subset construction over a wildly larger NFA is the slow way to discover
 * that. This bound fails fast and names the fix.
 */
export const MAX_NFA_STATES = 20_000;

interface Fragment {
  start: number;
  accept: number;
}

class Builder {
  readonly states: NfaState[] = [];

  private newState(): number {
    if (this.states.length >= MAX_NFA_STATES) {
      throw new RegexError(
        `Pattern expands past ${MAX_NFA_STATES} NFA states. Nested bounded repeats multiply — try smaller {n,m} bounds.`,
        0
      );
    }
    this.states.push({ eps: [], moves: [] });
    return this.states.length - 1;
  }

  private link(from: number, to: number): void {
    this.states[from].eps.push(to);
  }

  build(node: Ast): Fragment {
    switch (node.kind) {
      case "empty": {
        const s = this.newState();
        const a = this.newState();
        this.link(s, a);
        return { start: s, accept: a };
      }
      case "char": {
        const s = this.newState();
        const a = this.newState();
        this.states[s].moves.push({ set: node.set, to: a });
        return { start: s, accept: a };
      }
      case "concat": {
        let frag: Fragment | null = null;
        for (const part of node.parts) {
          const next = this.build(part);
          if (frag === null) frag = next;
          else {
            this.link(frag.accept, next.start);
            frag = { start: frag.start, accept: next.accept };
          }
        }
        return frag ?? this.build({ kind: "empty" });
      }
      case "alt": {
        const s = this.newState();
        const a = this.newState();
        for (const option of node.options) {
          const frag = this.build(option);
          this.link(s, frag.start);
          this.link(frag.accept, a);
        }
        return { start: s, accept: a };
      }
      case "repeat":
        return this.buildRepeat(node);
    }
  }

  private buildRepeat(node: Extract<Ast, { kind: "repeat" }>): Fragment {
    const { min, max } = node;

    if (max === Infinity) {
      // X{min,} = min mandatory copies followed by a Kleene star.
      const pieces: Fragment[] = [];
      for (let i = 0; i < min; i += 1) pieces.push(this.build(node.node));
      pieces.push(this.star(node.node));
      return this.chain(pieces);
    }

    if (max === 0) return this.build({ kind: "empty" });

    const pieces: Fragment[] = [];
    for (let i = 0; i < min; i += 1) pieces.push(this.build(node.node));
    for (let i = min; i < max; i += 1) pieces.push(this.optional(node.node));
    if (pieces.length === 0) return this.build({ kind: "empty" });
    return this.chain(pieces);
  }

  private chain(pieces: Fragment[]): Fragment {
    let frag = pieces[0];
    for (let i = 1; i < pieces.length; i += 1) {
      this.link(frag.accept, pieces[i].start);
      frag = { start: frag.start, accept: pieces[i].accept };
    }
    return frag;
  }

  private optional(inner: Ast): Fragment {
    const s = this.newState();
    const a = this.newState();
    const frag = this.build(inner);
    this.link(s, frag.start);
    this.link(frag.accept, a);
    this.link(s, a);
    return { start: s, accept: a };
  }

  private star(inner: Ast): Fragment {
    const s = this.newState();
    const a = this.newState();
    const frag = this.build(inner);
    this.link(s, frag.start);
    this.link(s, a);
    this.link(frag.accept, frag.start);
    this.link(frag.accept, a);
    return { start: s, accept: a };
  }
}

export function buildNfa(ast: Ast): Nfa {
  const builder = new Builder();
  const frag = builder.build(ast);
  return { states: builder.states, start: frag.start, accept: frag.accept };
}

/** ε-closure of a set of NFA states, returned sorted so it can be keyed. */
export function epsilonClosure(nfa: Nfa, seed: Iterable<number>): number[] {
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const s of seed) {
    if (!seen.has(s)) {
      seen.add(s);
      stack.push(s);
    }
  }
  while (stack.length > 0) {
    const s = stack.pop() as number;
    for (const t of nfa.states[s].eps) {
      if (!seen.has(t)) {
        seen.add(t);
        stack.push(t);
      }
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}
