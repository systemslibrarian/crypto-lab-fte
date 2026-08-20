/**
 * Reduced-leakage ranking: item 6.
 *
 * ── Read this before trusting the name ─────────────────────────────────────
 *
 * These functions are NOT constant-time, and calling them that would be the
 * kind of claim this lab exists to avoid. What they remove is the SECRET-
 * DEPENDENT CONTROL FLOW in `rank.ts`. What they cannot remove, in JavaScript,
 * is variable-time arithmetic.
 *
 * The original `unrank` walks the runs of the alphabet partition and BREAKS as
 * soon as the remaining index falls inside a run's block. Which run that is, at
 * every one of the n positions, is a direct function of the secret index — so
 * the loop trip count, the branch history and the memory access pattern all
 * carry it. That is a textbook timing and microarchitectural leak, and on this
 * page the secret is the enciphered ciphertext.
 *
 * Below, every position visits EVERY run, unconditionally, and the choice is
 * made by arithmetic rather than by branching:
 *
 *     take   = (remaining < block) & !done      as 0n or 1n
 *     offset = select(take, thisOffset, offset)
 *     state  = select(take, thisState,  state)
 *
 * `select` is `(mask * a) + ((1 - mask) * b)`, which evaluates both sides and
 * has no branch in it.
 *
 * WHAT STILL LEAKS, precisely:
 *
 *   1. BigInt is variable-time. Its operations are sized to their operands, so
 *      arithmetic on a small remainder is measurably faster than on a large
 *      one. Closing this needs fixed-width limb arithmetic over Uint32Array
 *      with carries done by hand — a substantial piece of work, and the honest
 *      next step for anyone who needs the real property.
 *   2. BigInt allocates. GC timing correlates with operand size.
 *   3. The JIT may reintroduce branches when specialising this code.
 *
 * So: this closes the loudest channel — the one visible in a single trace and
 * in the loop counts — and leaves a quieter arithmetic one. It is a real
 * improvement and it is not a guarantee. In a threat model with a local or
 * co-resident attacker, do not rely on it.
 *
 * Correctness is not on the honour system: `rankct.test.ts` checks these agree
 * with `rank.ts` over entire language slices, so the branchless versions are
 * bijections onto the same integers in the same order.
 */

import { Dfa, step } from "./regex/dfa.ts";
import { CountTable, NotInLanguageError } from "./rank.ts";

/** 1n when `condition`, else 0n — from a boolean, without branching on it. */
function mask(condition: boolean): bigint {
  return BigInt(condition ? 1 : 0);
}

/** Branchless select over BigInt: both arms are always evaluated. */
function selectBig(m: bigint, whenSet: bigint, whenClear: bigint): bigint {
  return m * whenSet + (1n - m) * whenClear;
}

/** Branchless select over small integers. */
function selectNum(m: bigint, whenSet: number, whenClear: number): number {
  return Number(m) * whenSet + (1 - Number(m)) * whenClear;
}

/**
 * Integer → string, visiting every run at every position.
 *
 * The shape mirrors `unrank` in `rank.ts` exactly, minus the early exit: where
 * that function breaks out of the run loop, this one sets `done` and keeps
 * going, discarding the rest arithmetically.
 */
export function unrankFixed(dfa: Dfa, table: CountTable, index: bigint): string {
  if (index < 0n || index >= table.total) {
    // Bounds are public — the caller already knows N — so this branch leaks
    // nothing a reader of the page cannot see in the stat grid.
    throw new RangeError(`Index ${index} is outside [0, N) with N = ${table.total}.`);
  }

  let remaining = index;
  let q = dfa.start;
  const codes: number[] = [];

  for (let k = table.n; k >= 1; k -= 1) {
    const prev = table.rows[k - 1];
    let done = 0n;
    let chosenCode = 0;
    let chosenState = q;
    let nextRemaining = remaining;

    for (const run of dfa.runs) {
      const t = step(dfa, q, run.cls);
      // A missing transition or a dead end contributes nothing. This depends on
      // the DFA and the position, both public, never on the index.
      const usable = t >= 0 && prev[t] !== 0n;
      const count = usable ? prev[t] : 1n; // 1n keeps the divide well-defined
      const block = usable ? BigInt(run.len) * count : 0n;

      // take = usable AND not already done AND remaining < block
      const take = mask(usable) * (1n - done) * mask(remaining < block);

      const offset = remaining / count;
      chosenCode = selectNum(take, run.lo + Number(offset % BigInt(run.len)), chosenCode);
      chosenState = selectNum(take, t, chosenState);
      nextRemaining = selectBig(take, remaining % count, nextRemaining);

      // Advance past this block only when it was not taken and was usable.
      const skip = mask(usable) * (1n - done) * (1n - take);
      remaining = selectBig(skip, remaining - block, remaining);
      done = done | take;
    }

    if (done === 0n) {
      throw new Error("unrank walked off the count table — the table and the DFA disagree.");
    }
    codes.push(chosenCode);
    q = chosenState;
    remaining = nextRemaining;
  }

  return String.fromCodePoint(...codes);
}

/**
 * String → integer, visiting every run at every position.
 *
 * The membership failures below DO branch, and deliberately: a string that is
 * not in the language is not secret — the adversary supplied it. What must not
 * branch is the accumulation for a string that IS in the language, and that is
 * what the run loop avoids.
 */
export function rankFixed(dfa: Dfa, table: CountTable, text: string): bigint {
  const codes = Array.from(text, (ch) => ch.codePointAt(0) as number);
  if (codes.length !== table.n) {
    throw new NotInLanguageError(
      `This string is ${codes.length} characters; the current format is fixed at n = ${table.n}.`
    );
  }

  let acc = 0n;
  let q = dfa.start;

  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    const prev = table.rows[table.n - i - 1];
    let matched = 0n;
    let nextState = q;
    let contribution = 0n;
    let running = 0n;

    for (const run of dfa.runs) {
      const t = step(dfa, q, run.cls);
      const count = t < 0 ? 0n : prev[t];
      const inRun = code >= run.lo && code <= run.hi;
      const take = mask(inRun) * (1n - matched);

      // The symbol's own offset within its run, plus every block before it.
      contribution = selectBig(take, running + BigInt(code - run.lo) * count, contribution);
      nextState = selectNum(take, t, nextState);
      // Runs after the matched one must not keep accumulating.
      running = selectBig(1n - matched, running + BigInt(run.len) * count, running);
      matched = matched | take;

      // Recorded, then reported after the loop — reporting here would restore
      // the early exit this function exists to remove.
      if (take === 1n && count === 0n) {
        matched = matched | 1n;
        nextState = -1;
      }
    }

    if (matched === 0n || nextState < 0) {
      throw new NotInLanguageError(
        `'${text[i]}' at position ${i} is not accepted here by this pattern.`
      );
    }
    acc += contribution;
    q = nextState;
  }

  if (!dfa.accepting[q]) {
    throw new NotInLanguageError("The string ends in a non-accepting state — it is not a full match.");
  }
  return acc;
}
