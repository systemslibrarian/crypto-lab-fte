/**
 * The alphabet Σ, and character sets as sorted disjoint code-point intervals.
 *
 * Σ is fixed for this lab: printable ASCII plus the two whitespace characters
 * `\s` names beyond the space itself.
 *
 *     Σ = { 0x09 TAB, 0x0A LF } ∪ [0x20 .. 0x7E]        (97 symbols)
 *
 * Every stego string this lab emits is a string over Σ, and Σ's *code-point
 * order* is the order the rank/unrank bijection walks. That is the whole reason
 * character sets are represented as intervals rather than as a `Set<number>`:
 * the ranking has to enumerate symbols in a canonical order and count runs of
 * them in O(1), and an interval list gives both for free.
 *
 * `.` is deliberately NOT all of Σ — it is printable ASCII only, matching the
 * usual regex convention that dot does not cross a line break. So a pattern can
 * reach TAB/LF only by asking for them (`\s`, an explicit escape, or a negated
 * class), which is what keeps `.`-heavy formats human-plausible.
 */

export interface Interval {
  /** First code point, inclusive. */
  lo: number;
  /** Last code point, inclusive. */
  hi: number;
}

/** A set of code points, as sorted, disjoint, non-adjacent intervals. */
export type CharSet = Interval[];

/** Σ itself. */
export const SIGMA: CharSet = [
  { lo: 0x09, hi: 0x0a },
  { lo: 0x20, hi: 0x7e }
];

export const SIGMA_SIZE = 97;

/** `.` — any printable ASCII. Not TAB, not LF. */
export const DOT: CharSet = [{ lo: 0x20, hi: 0x7e }];

/** `\d` — ASCII digits only, never Unicode digits. */
export const CLASS_D: CharSet = [{ lo: 0x30, hi: 0x39 }];

/** `\w` — `[A-Za-z0-9_]`. */
export const CLASS_W: CharSet = [
  { lo: 0x30, hi: 0x39 },
  { lo: 0x41, hi: 0x5a },
  { lo: 0x5f, hi: 0x5f },
  { lo: 0x61, hi: 0x7a }
];

/** `\s` — space, tab, newline. The only three Σ admits. */
export const CLASS_S: CharSet = [
  { lo: 0x09, hi: 0x0a },
  { lo: 0x20, hi: 0x20 }
];

export function setSize(set: CharSet): number {
  let n = 0;
  for (const iv of set) n += iv.hi - iv.lo + 1;
  return n;
}

export function setContains(set: CharSet, code: number): boolean {
  for (const iv of set) {
    if (code >= iv.lo && code <= iv.hi) return true;
  }
  return false;
}

export function inSigma(code: number): boolean {
  return setContains(SIGMA, code);
}

/**
 * Sort, merge and coalesce. Adjacent intervals are merged (`[a-b]` + `[c-c]`
 * where c = b+1 becomes one interval), which matters because the equivalence-class
 * splitter below reports one class per maximal run and two runs that touch are
 * one run.
 */
export function normalize(intervals: Interval[]): CharSet {
  const sorted = intervals
    .filter((iv) => iv.lo <= iv.hi)
    .slice()
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, iv.hi);
    } else {
      out.push({ lo: iv.lo, hi: iv.hi });
    }
  }
  return out;
}

export function union(a: CharSet, b: CharSet): CharSet {
  return normalize([...a, ...b]);
}

export function intersect(a: CharSet, b: CharSet): CharSet {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i].lo, b[j].lo);
    const hi = Math.min(a[i].hi, b[j].hi);
    if (lo <= hi) out.push({ lo, hi });
    if (a[i].hi < b[j].hi) i += 1;
    else j += 1;
  }
  return normalize(out);
}

/** Complement *within Σ* — `[^…]` can never leave the alphabet. */
export function complementInSigma(set: CharSet): CharSet {
  const out: Interval[] = [];
  for (const region of SIGMA) {
    let cursor = region.lo;
    for (const iv of set) {
      if (iv.hi < region.lo || iv.lo > region.hi) continue;
      const lo = Math.max(iv.lo, region.lo);
      const hi = Math.min(iv.hi, region.hi);
      if (lo > cursor) out.push({ lo: cursor, hi: lo - 1 });
      cursor = Math.max(cursor, hi + 1);
    }
    if (cursor <= region.hi) out.push({ lo: cursor, hi: region.hi });
  }
  return normalize(out);
}

/** Clip a set to Σ. A literal outside Σ is rejected by the parser, not clipped. */
export function clipToSigma(set: CharSet): CharSet {
  return intersect(normalize(set), SIGMA);
}

/** All code points of Σ in ascending order — the canonical ranking order. */
export function sigmaSymbols(): number[] {
  const out: number[] = [];
  for (const iv of SIGMA) {
    for (let c = iv.lo; c <= iv.hi; c += 1) out.push(c);
  }
  return out;
}

const NAMED: Record<number, string> = {
  0x09: "\\t",
  0x0a: "\\n",
  0x20: "SP"
};

/** A one-character label safe to drop into an SVG label or a table cell. */
export function charLabel(code: number): string {
  return NAMED[code] ?? String.fromCodePoint(code);
}

/** `[0-9]`-style label for a set, truncated so an edge label stays readable. */
export function setLabel(set: CharSet, maxParts = 3): string {
  const parts = set.map((iv) =>
    iv.lo === iv.hi ? charLabel(iv.lo) : `${charLabel(iv.lo)}-${charLabel(iv.hi)}`
  );
  if (parts.length <= maxParts) return parts.join(",");
  return `${parts.slice(0, maxParts).join(",")}…(+${parts.length - maxParts})`;
}
