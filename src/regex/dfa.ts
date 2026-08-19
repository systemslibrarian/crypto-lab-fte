/**
 * NFA → DFA: subset construction over alphabet equivalence classes, then
 * Hopcroft minimization, then a trim to the live states.
 *
 * ── Why equivalence classes ────────────────────────────────────────────────
 * Σ has 97 symbols. A DFA that stores one transition per symbol would make the
 * counting DP below do 97 BigInt additions per (state, length) cell, and the
 * visualizer would draw 97 parallel edges where a human sees one. So Σ is
 * partitioned into the coarsest set of classes such that every symbol in a class
 * has the SAME transition from EVERY state — computed from the character sets
 * that actually appear in the pattern, so `[0-9a-f]{32}` gets two classes
 * (`0-9`, `a-f`) plus the leftovers, not 97.
 *
 * The classes are then cut into maximal *contiguous* code-point runs. That is
 * the part the ranking depends on: rank/unrank walks Σ in ascending code-point
 * order, and a run gives both "how many symbols" (a multiply) and "which symbol
 * is at offset i" (an add) in O(1), while preserving strict lexicographic order
 * inside the class.
 *
 * ── Why trim ───────────────────────────────────────────────────────────────
 * Subset construction produces a dead state (the empty set) whenever the pattern
 * is not total, and minimization keeps it. It contributes zero to every count,
 * so it is removed and its incoming transitions become -1. What is left is the
 * unique minimal *trim* DFA: every state is reachable from the start and can
 * reach an accepting state.
 */

import {
  CharSet,
  SIGMA_SIZE,
  normalize,
  setContains,
  setLabel,
  setSize,
  sigmaSymbols
} from "./alphabet.ts";
import { Nfa, epsilonClosure } from "./nfa.ts";

/** One alphabet equivalence class. */
export interface EquivClass {
  index: number;
  /** The symbols in the class, as intervals. */
  set: CharSet;
  /** |class| — how many symbols it stands for. */
  size: number;
  /** A representative code point, used to drive transitions and label edges. */
  rep: number;
  /** Human label, e.g. `0-9` or `a-f`. */
  label: string;
}

/** A maximal contiguous code-point run inside one class. */
export interface SymbolRun {
  lo: number;
  hi: number;
  len: number;
  cls: number;
}

export interface DfaStats {
  nfaStates: number;
  statesBeforeMinimization: number;
  states: number;
  classes: number;
  /** Defined transitions, i.e. not the dead sink. */
  transitions: number;
}

export interface Dfa {
  numStates: number;
  start: number;
  accepting: boolean[];
  /** Flat `numStates * classes.length` table; -1 means "no transition". */
  delta: Int32Array;
  classes: EquivClass[];
  /** Σ partitioned into contiguous runs, ascending. The ranking order. */
  runs: SymbolRun[];
  stats: DfaStats;
}

export class DfaTooLargeError extends Error {
  readonly states: number;
  constructor(states: number, limit: number) {
    super(
      `DFA has ${states} states, over this lab's limit of ${limit}. ` +
        `Subset construction is exponential in the worst case — tighten the pattern ` +
        `(fewer alternations under a repeat, smaller {n,m} bounds).`
    );
    this.name = "DfaTooLargeError";
    this.states = states;
  }
}

export class EmptyLanguageError extends Error {
  constructor() {
    super("This pattern matches no string at all, so there is nothing to encode into.");
    this.name = "EmptyLanguageError";
  }
}

/** The lab's stated ceiling on |Q|. */
export const MAX_DFA_STATES = 4096;

function keyOfSet(set: CharSet): string {
  return set.map((iv) => `${iv.lo}-${iv.hi}`).join(",");
}

/**
 * Partition Σ so that two symbols share a class exactly when they belong to the
 * same subset of the pattern's character sets. That condition is what makes the
 * class transition-identical from every state: a transition fires on a symbol
 * only through one of those sets.
 */
function computeClasses(nfa: Nfa): { classes: EquivClass[]; runs: SymbolRun[] } {
  const distinct = new Map<string, CharSet>();
  for (const state of nfa.states) {
    for (const move of state.moves) {
      const key = keyOfSet(move.set);
      if (!distinct.has(key)) distinct.set(key, move.set);
    }
  }

  const symbols = sigmaSymbols();
  const signature = new Map<number, number[]>();
  for (const code of symbols) signature.set(code, []);

  let setId = 0;
  for (const set of distinct.values()) {
    for (const iv of set) {
      for (let c = iv.lo; c <= iv.hi; c += 1) {
        signature.get(c)?.push(setId);
      }
    }
    setId += 1;
  }

  const groups = new Map<string, number[]>();
  for (const code of symbols) {
    const key = (signature.get(code) as number[]).join(".");
    const bucket = groups.get(key);
    if (bucket) bucket.push(code);
    else groups.set(key, [code]);
  }

  // Order classes by their lowest code point so the class indices themselves
  // read in alphabet order — nothing depends on it, but every table on the page
  // is easier to read.
  const ordered = Array.from(groups.values()).sort((a, b) => a[0] - b[0]);
  const classes: EquivClass[] = ordered.map((codes, index) => {
    const set = normalize(codes.map((c) => ({ lo: c, hi: c })));
    return { index, set, size: codes.length, rep: codes[0], label: setLabel(set) };
  });

  const classOf = new Map<number, number>();
  for (const cls of classes) {
    for (const iv of cls.set) {
      for (let c = iv.lo; c <= iv.hi; c += 1) classOf.set(c, cls.index);
    }
  }

  const runs: SymbolRun[] = [];
  for (const code of symbols) {
    const cls = classOf.get(code) as number;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls && last.hi === code - 1) {
      last.hi = code;
      last.len += 1;
    } else {
      runs.push({ lo: code, hi: code, len: 1, cls });
    }
  }

  return { classes, runs };
}

interface RawDfa {
  numStates: number;
  start: number;
  accepting: boolean[];
  delta: Int32Array;
  dead: number;
}

function subsetConstruction(nfa: Nfa, classes: EquivClass[]): RawDfa {
  const k = classes.length;
  const index = new Map<string, number>();
  const sets: number[][] = [];
  const rows: number[][] = [];
  const accepting: boolean[] = [];

  const intern = (states: number[]): number => {
    const key = states.join(",");
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    if (sets.length >= MAX_DFA_STATES) throw new DfaTooLargeError(sets.length + 1, MAX_DFA_STATES);
    const id = sets.length;
    index.set(key, id);
    sets.push(states);
    rows.push(new Array<number>(k).fill(-1));
    accepting.push(states.includes(nfa.accept));
    return id;
  };

  // The dead state is state 0's sibling: interning the empty set gives a state
  // with no accepting NFA state and self-loops on every class, added below.
  const startId = intern(epsilonClosure(nfa, [nfa.start]));
  const deadId = intern([]);

  // Precompute, per class, which NFA states each source state can move to.
  const worklist = [startId];
  const done = new Set<number>([deadId]);
  while (worklist.length > 0) {
    const id = worklist.pop() as number;
    if (done.has(id)) continue;
    done.add(id);
    const members = sets[id];
    for (const cls of classes) {
      const targets: number[] = [];
      for (const s of members) {
        for (const move of nfa.states[s].moves) {
          if (setContains(move.set, cls.rep)) targets.push(move.to);
        }
      }
      const next = targets.length === 0 ? deadId : intern(epsilonClosure(nfa, targets));
      rows[id][cls.index] = next;
      if (!done.has(next)) worklist.push(next);
    }
  }
  for (const cls of classes) rows[deadId][cls.index] = deadId;

  const numStates = sets.length;
  const delta = new Int32Array(numStates * k);
  for (let q = 0; q < numStates; q += 1) {
    for (let c = 0; c < k; c += 1) delta[q * k + c] = rows[q][c] ?? deadId;
  }
  return { numStates, start: startId, accepting, delta, dead: deadId };
}

/**
 * Hopcroft's algorithm. Partition refinement driven by a worklist of
 * (block, class) splitters, always queueing the smaller half — that is the part
 * that buys the n log n and the part most "Hopcroft" implementations quietly
 * drop back to Moore's O(n²) by omitting.
 */
function hopcroft(raw: RawDfa, numClasses: number): RawDfa {
  const { numStates, delta } = raw;

  // Inverse transitions, as a flat CSR-style structure per class.
  const preds: number[][][] = [];
  for (let c = 0; c < numClasses; c += 1) {
    const byTarget: number[][] = Array.from({ length: numStates }, () => []);
    for (let q = 0; q < numStates; q += 1) {
      const t = delta[q * numClasses + c];
      if (t >= 0) byTarget[t].push(q);
    }
    preds.push(byTarget);
  }

  const blockOf = new Int32Array(numStates);
  const blocks: Set<number>[] = [];
  const accept = new Set<number>();
  const reject = new Set<number>();
  for (let q = 0; q < numStates; q += 1) (raw.accepting[q] ? accept : reject).add(q);
  for (const b of [accept, reject]) {
    if (b.size === 0) continue;
    const id = blocks.length;
    blocks.push(b);
    for (const q of b) blockOf[q] = id;
  }

  const pending = new Set<string>();
  const work: Array<{ block: number; cls: number }> = [];
  const smaller = blocks.length === 2 ? (accept.size <= reject.size ? 0 : 1) : 0;
  for (let c = 0; c < numClasses; c += 1) {
    work.push({ block: smaller, cls: c });
    pending.add(`${smaller}|${c}`);
  }

  while (work.length > 0) {
    const item = work.pop() as { block: number; cls: number };
    pending.delete(`${item.block}|${item.cls}`);
    const target = blocks[item.block];
    if (!target || target.size === 0) continue;

    // X = every state whose `cls` transition lands inside `target`.
    const x = new Set<number>();
    for (const q of target) {
      for (const p of preds[item.cls][q]) x.add(p);
    }
    if (x.size === 0) continue;

    // Which blocks does X cut?
    const touched = new Map<number, number[]>();
    for (const q of x) {
      const b = blockOf[q];
      const bucket = touched.get(b);
      if (bucket) bucket.push(q);
      else touched.set(b, [q]);
    }

    for (const [bIndex, members] of touched) {
      const block = blocks[bIndex];
      if (members.length === block.size) continue; // not split

      const inside = new Set(members);
      const outside = new Set<number>();
      for (const q of block) if (!inside.has(q)) outside.add(q);

      blocks[bIndex] = inside;
      const newIndex = blocks.length;
      blocks.push(outside);
      for (const q of outside) blockOf[q] = newIndex;

      for (let c = 0; c < numClasses; c += 1) {
        const key = `${bIndex}|${c}`;
        if (pending.has(key)) {
          work.push({ block: newIndex, cls: c });
          pending.add(`${newIndex}|${c}`);
        } else {
          const pick = inside.size <= outside.size ? bIndex : newIndex;
          work.push({ block: pick, cls: c });
          pending.add(`${pick}|${c}`);
        }
      }
    }
  }

  const merged = blocks.length;
  const newDelta = new Int32Array(merged * numClasses);
  const newAccepting = new Array<boolean>(merged).fill(false);
  for (let b = 0; b < merged; b += 1) {
    const representative = blocks[b].values().next().value as number;
    newAccepting[b] = raw.accepting[representative];
    for (let c = 0; c < numClasses; c += 1) {
      const t = delta[representative * numClasses + c];
      newDelta[b * numClasses + c] = t < 0 ? -1 : blockOf[t];
    }
  }
  return {
    numStates: merged,
    start: blockOf[raw.start],
    accepting: newAccepting,
    delta: newDelta,
    dead: blockOf[raw.dead]
  };
}

/** Drop states that cannot reach an accepting state, and renumber. */
function trim(raw: RawDfa, numClasses: number): RawDfa {
  const live = new Array<boolean>(raw.numStates).fill(false);
  const queue: number[] = [];
  for (let q = 0; q < raw.numStates; q += 1) {
    if (raw.accepting[q]) {
      live[q] = true;
      queue.push(q);
    }
  }
  const preds: number[][] = Array.from({ length: raw.numStates }, () => []);
  for (let q = 0; q < raw.numStates; q += 1) {
    for (let c = 0; c < numClasses; c += 1) {
      const t = raw.delta[q * numClasses + c];
      if (t >= 0) preds[t].push(q);
    }
  }
  while (queue.length > 0) {
    const q = queue.pop() as number;
    for (const p of preds[q]) {
      if (!live[p]) {
        live[p] = true;
        queue.push(p);
      }
    }
  }

  if (!live[raw.start]) throw new EmptyLanguageError();

  const remap = new Int32Array(raw.numStates).fill(-1);
  let next = 0;
  // The start state takes index 0 so every table on the page reads q0 first.
  remap[raw.start] = next;
  next += 1;
  for (let q = 0; q < raw.numStates; q += 1) {
    if (live[q] && remap[q] < 0) {
      remap[q] = next;
      next += 1;
    }
  }

  const delta = new Int32Array(next * numClasses).fill(-1);
  const accepting = new Array<boolean>(next).fill(false);
  for (let q = 0; q < raw.numStates; q += 1) {
    if (!live[q]) continue;
    const nq = remap[q];
    accepting[nq] = raw.accepting[q];
    for (let c = 0; c < numClasses; c += 1) {
      const t = raw.delta[q * numClasses + c];
      delta[nq * numClasses + c] = t >= 0 && live[t] ? remap[t] : -1;
    }
  }
  return { numStates: next, start: 0, accepting, delta, dead: -1 };
}

export function buildDfa(nfa: Nfa): Dfa {
  const { classes, runs } = computeClasses(nfa);
  const raw = subsetConstruction(nfa, classes);
  const minimized = hopcroft(raw, classes.length);
  const trimmed = trim(minimized, classes.length);

  let transitions = 0;
  for (let i = 0; i < trimmed.delta.length; i += 1) if (trimmed.delta[i] >= 0) transitions += 1;

  if (trimmed.numStates > MAX_DFA_STATES) {
    throw new DfaTooLargeError(trimmed.numStates, MAX_DFA_STATES);
  }

  return {
    numStates: trimmed.numStates,
    start: trimmed.start,
    accepting: trimmed.accepting,
    delta: trimmed.delta,
    classes,
    runs,
    stats: {
      nfaStates: nfa.states.length,
      statesBeforeMinimization: raw.numStates,
      states: trimmed.numStates,
      classes: classes.length,
      transitions
    }
  };
}

/** δ(q, class). -1 means the transition is undefined (the trimmed sink). */
export function step(dfa: Dfa, state: number, cls: number): number {
  return dfa.delta[state * dfa.classes.length + cls];
}

/** δ(q, symbol) by code point, or -1. */
export function stepSymbol(dfa: Dfa, state: number, code: number): number {
  for (const run of dfa.runs) {
    if (code >= run.lo && code <= run.hi) return step(dfa, state, run.cls);
  }
  return -1;
}

/** Sanity: the runs really do partition Σ. Used by the tests, not the UI. */
export function runsCoverSigma(dfa: Dfa): boolean {
  let total = 0;
  for (const run of dfa.runs) total += run.len;
  return total === SIGMA_SIZE && dfa.classes.reduce((a, c) => a + setSize(c.set), 0) === SIGMA_SIZE;
}
