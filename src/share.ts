/**
 * Teaching state in the URL, and nothing else in the URL.
 *
 * A lab gets used by being linked: "open this and press Encode" is how it lands
 * in a lecture, a slide, or a bug report. What travels is the pattern, the
 * length, the preset and the message — the things that make a page state
 * reproducible.
 *
 * What must never travel is the passphrase, the salt, or any derived key. URLs
 * are pasted into chat windows, written to server logs, kept in history, and
 * synced between devices; a passphrase in a fragment is a passphrase published.
 * `assertNoSecrets` exists so that this is a tested property rather than a
 * promise, and `e2e/claims.spec.ts` checks it against a real encode.
 *
 * Parsing is total. A hostile or truncated fragment yields defaults, never a
 * throw and never a partially-applied state — the page must open.
 */

export interface ShareState {
  preset: string;
  pattern: string;
  n: number;
  message: string;
  /** Classifier rule, when the reader has changed it away from the format. */
  classifier?: string;
  /** Guided-path step, 1-based; absent when the tour is not running. */
  step?: number;
}

/** Fields that are allowed into the fragment. Anything else is dropped. */
const KEYS = ["preset", "pattern", "n", "message", "classifier", "step"] as const;

const MAX_FIELD = 2048;

export function encodeState(state: ShareState): string {
  const params = new URLSearchParams();
  params.set("preset", state.preset);
  params.set("pattern", state.pattern);
  params.set("n", String(state.n));
  params.set("message", state.message);
  if (state.classifier !== undefined) params.set("classifier", state.classifier);
  if (state.step !== undefined) params.set("step", String(state.step));
  return params.toString();
}

export function decodeState(fragment: string): Partial<ShareState> {
  const out: Partial<ShareState> = {};
  const text = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (text.length === 0) return out;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return out;
  }

  for (const key of KEYS) {
    const raw = params.get(key);
    if (raw === null || raw.length > MAX_FIELD) continue;
    if (key === "n" || key === "step") {
      const value = Number(raw);
      // Reject NaN, fractions, negatives and Infinity in one test; the caller
      // clamps to its own ceiling, this only guarantees a sane integer.
      if (!Number.isSafeInteger(value) || value < 0) continue;
      out[key] = value;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Throws if anything secret reached the fragment. Called on every write, so a
 * future field that carelessly includes key material fails loudly in the
 * browser and in the claims suite rather than leaking quietly.
 */
export function assertNoSecrets(fragment: string, secrets: string[]): void {
  const text = fragment.startsWith("#") ? fragment.slice(1) : fragment;

  // Compare against the DECODED values, not the encoded text. `URLSearchParams`
  // writes a space as `+`, which `decodeURIComponent` leaves as `+` — so a
  // passphrase containing a space would have walked straight past a naive
  // decode of the whole fragment. Parsing it back the way a browser would is
  // the only reading that cannot be fooled by an encoding difference. The raw
  // text stays in the haystack as well, so a secret that never round-tripped
  // through a parameter is still caught.
  const haystacks: string[] = [text.toLowerCase()];
  try {
    for (const [key, value] of new URLSearchParams(text)) {
      haystacks.push(key.toLowerCase(), value.toLowerCase());
    }
  } catch {
    // Unparseable fragment: the raw text above is all we have, and it is enough.
  }

  for (const secret of secrets) {
    if (secret.length === 0) continue;
    const needle = secret.toLowerCase();
    if (haystacks.some((hay) => hay.includes(needle))) {
      throw new Error("Refusing to write a URL containing key material.");
    }
  }
}
