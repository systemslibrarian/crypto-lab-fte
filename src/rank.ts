/**
 * The bijection: {0, 1, …, N-1} ↔ the length-n strings the DFA accepts.
 *
 * This is the half of FTE that is pure combinatorics — no key, no cipher, no
 * secret. Goldberg and Sipser (1985) gave the construction for compressing a
 * language; Bellare, Ristenpart, Rogaway and Stegers (SAC 2009) named the use
 * of it here: **rank-then-encipher**. Rank a language member to an integer,
 * encipher the integer inside the language's own size, unrank back. The cipher
 * never sees a string and the language never sees a key.
 *
 * ── The count table ────────────────────────────────────────────────────────
 *     C[k][q] = how many strings of length EXACTLY k take state q to an
 *               accepting state
 *     C[0][q] = 1 if q is accepting, else 0
 *     C[k][q] = Σ over alphabet classes c of  |c| · C[k-1][δ(q, c)]
 *
 * and N = C[n][q0]. Every entry is a BigInt: for a 64-character base64 block
 * N is 64^64 ≈ 2^384, which double-precision floats stopped being able to
 * count exactly at 2^53.
 *
 * ── Canonical order ────────────────────────────────────────────────────────
 * Rank and unrank both walk Σ in ascending code-point order, so string i is the
 * i-th accepted string lexicographically (by code point, over strings of the
 * same fixed length n). Two properties follow, and the demo depends on both:
 * unrank(rank(s)) = s for every accepted s, and rank is a *bijection onto*
 * [0, N) — no gaps, so enciphering inside [0, N) can land anywhere in the
 * language and nowhere outside it.
 */

import { Dfa, step } from "./regex/dfa.ts";
import { inSigma } from "./regex/alphabet.ts";

export interface CountTable {
  /** The fixed string length this table is for. */
  n: number;
  /** rows[k][q] = C[k][q]; length n+1. */
  rows: bigint[][];
  /** N = C[n][q0]. */
  total: bigint;
  /** floor(log2 N) — whole bits of payload the language can carry at this n. */
  capacityBits: number;
  /** Rough heap cost of `rows`, for the size guard the UI reports. */
  estimatedBytes: number;
}

export class CountTableTooLargeError extends Error {
  constructor(bytes: number, limit: number) {
    super(
      `The count table for these parameters would need about ${(bytes / 1_048_576).toFixed(1)} MB ` +
        `of BigInt storage, over this lab's ${(limit / 1_048_576).toFixed(0)} MB ceiling. ` +
        `Reduce n, or use a pattern with fewer DFA states.`
    );
    this.name = "CountTableTooLargeError";
  }
}

export class NotInLanguageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotInLanguageError";
  }
}

/** The lab's stated ceiling on the DP table. */
export const MAX_TABLE_BYTES = 50 * 1024 * 1024;

/** The lab's stated ceiling on n. */
export const MAX_N = 512;

/**
 * The number of bits in x — that is, floor(log2 x) + 1 for x ≥ 1, and 0 for 0.
 *
 * Named for what it returns, and documented as such because the near-miss is
 * costly: capacity is floor(log2 N), which is this MINUS ONE, and every capacity
 * figure on the page goes through `capacityBitsOf` for exactly that reason.
 */
export function bitLength(x: bigint): number {
  if (x <= 0n) return 0;
  return x.toString(2).length;
}

export function capacityBitsOf(total: bigint): number {
  return total <= 0n ? 0 : bitLength(total) - 1;
}

/**
 * Estimate the heap the table will take before allocating it.
 *
 * A BigInt cannot live in a typed array — V8 stores each one as a heap object of
 * a header plus 64-bit limbs — so the flat-typed-array trick that works for a
 * numeric DP does not apply here, and the honest thing is to measure the real
 * shape: (n+1) × |Q| BigInts whose magnitude grows with k.
 */
export function estimateTableBytes(dfa: Dfa, n: number): number {
  const perSymbolBits = Math.log2(Math.max(2, dfa.runs.reduce((a, r) => a + r.len, 0)));
  let bytes = 0;
  for (let k = 0; k <= n; k += 1) {
    const limbs = Math.max(1, Math.ceil((k * perSymbolBits) / 64));
    // 16-byte object header + 8 bytes per limb + one pointer in the row array.
    bytes += dfa.numStates * (16 + limbs * 8 + 8);
  }
  return bytes;
}

/**
 * C[k][q0] for k = 0..maxN, computed with a single rolling row.
 *
 * The UI calls this on every keystroke to answer "what is the capacity at this
 * n?" and "how long a string does a 128-bit payload need?", so it must not
 * allocate the full table — memory here is O(|Q|), not O(n·|Q|).
 */
export function scanCapacity(dfa: Dfa, maxN: number): bigint[] {
  const classes = dfa.classes;
  let prev = new Array<bigint>(dfa.numStates);
  for (let q = 0; q < dfa.numStates; q += 1) prev[q] = dfa.accepting[q] ? 1n : 0n;
  const out: bigint[] = [prev[dfa.start]];

  for (let k = 1; k <= maxN; k += 1) {
    const cur = new Array<bigint>(dfa.numStates).fill(0n);
    for (let q = 0; q < dfa.numStates; q += 1) {
      let sum = 0n;
      for (const cls of classes) {
        const t = step(dfa, q, cls.index);
        if (t < 0) continue;
        const c = prev[t];
        if (c !== 0n) sum += BigInt(cls.size) * c;
      }
      cur[q] = sum;
    }
    prev = cur;
    out.push(prev[dfa.start]);
  }
  return out;
}

/** The full table, needed to rank and unrank at a fixed n. */
export function buildCountTable(dfa: Dfa, n: number): CountTable {
  if (n < 0 || n > MAX_N) throw new RangeError(`n must be between 0 and ${MAX_N}.`);
  const estimatedBytes = estimateTableBytes(dfa, n);
  if (estimatedBytes > MAX_TABLE_BYTES) {
    throw new CountTableTooLargeError(estimatedBytes, MAX_TABLE_BYTES);
  }

  const rows: bigint[][] = [];
  const base = new Array<bigint>(dfa.numStates);
  for (let q = 0; q < dfa.numStates; q += 1) base[q] = dfa.accepting[q] ? 1n : 0n;
  rows.push(base);

  for (let k = 1; k <= n; k += 1) {
    const prev = rows[k - 1];
    const cur = new Array<bigint>(dfa.numStates).fill(0n);
    for (let q = 0; q < dfa.numStates; q += 1) {
      let sum = 0n;
      for (const cls of dfa.classes) {
        const t = step(dfa, q, cls.index);
        if (t < 0) continue;
        const c = prev[t];
        if (c !== 0n) sum += BigInt(cls.size) * c;
      }
      cur[q] = sum;
    }
    rows.push(cur);
  }

  const total = rows[n][dfa.start];
  return { n, rows, total, capacityBits: capacityBitsOf(total), estimatedBytes };
}

/**
 * Integer → string. Walks the DFA once, choosing at each position the symbol
 * whose block of the remaining index range contains `index`.
 *
 * Inside one contiguous run every symbol leads to the same state, so the run
 * contributes `len · C[k-1][t]` strings and the symbol is picked by a single
 * division — which is what keeps unrank O(n · |runs|) instead of O(n · |Σ|).
 */
export function unrank(dfa: Dfa, table: CountTable, index: bigint): string {
  if (index < 0n || index >= table.total) {
    throw new RangeError(`Index ${index} is outside [0, N) with N = ${table.total}.`);
  }
  let remaining = index;
  let q = dfa.start;
  const codes: number[] = [];

  for (let k = table.n; k >= 1; k -= 1) {
    const prev = table.rows[k - 1];
    let placed = false;
    for (const run of dfa.runs) {
      const t = step(dfa, q, run.cls);
      if (t < 0) continue;
      const count = prev[t];
      if (count === 0n) continue;
      const block = BigInt(run.len) * count;
      if (remaining < block) {
        const offset = remaining / count;
        remaining %= count;
        codes.push(run.lo + Number(offset));
        q = t;
        placed = true;
        break;
      }
      remaining -= block;
    }
    if (!placed) {
      throw new Error("unrank walked off the count table — the table and the DFA disagree.");
    }
  }
  return String.fromCodePoint(...codes);
}

/**
 * String → integer. The exact inverse of `unrank`: at each position, add the
 * size of every block that sorts before the symbol actually taken.
 */
export function rank(dfa: Dfa, table: CountTable, text: string): bigint {
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
    if (!inSigma(code)) {
      throw new NotInLanguageError(
        `Character at position ${i} (U+${code.toString(16).toUpperCase().padStart(4, "0")}) is outside the alphabet.`
      );
    }
    const prev = table.rows[table.n - i - 1];
    let stepped = false;
    for (const run of dfa.runs) {
      const t = step(dfa, q, run.cls);
      const count = t < 0 ? 0n : prev[t];
      if (code >= run.lo && code <= run.hi) {
        if (count === 0n) {
          throw new NotInLanguageError(
            `'${text[i]}' at position ${i} is not accepted here by this pattern.`
          );
        }
        acc += BigInt(code - run.lo) * count;
        q = t;
        stepped = true;
        break;
      }
      acc += BigInt(run.len) * count;
    }
    if (!stepped) {
      throw new NotInLanguageError(`Character at position ${i} is not accepted here by this pattern.`);
    }
  }
  if (!dfa.accepting[q]) {
    throw new NotInLanguageError("The string ends in a non-accepting state — it is not a full match.");
  }
  return acc;
}

/**
 * The smallest n ≤ maxN whose slice of the language holds `bits` whole bits,
 * plus the capacity ladder the UI shows. Returns null when nothing fits.
 */
export function smallestLengthFor(
  counts: bigint[],
  bits: number
): { n: number; total: bigint; capacityBits: number } | null {
  for (let n = 0; n < counts.length; n += 1) {
    const capacity = capacityBitsOf(counts[n]);
    if (counts[n] > 0n && capacity >= bits) {
      return { n, total: counts[n], capacityBits: capacity };
    }
  }
  return null;
}
