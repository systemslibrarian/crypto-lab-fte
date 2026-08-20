/**
 * The adversary FTE was built to defeat, implemented and pointed at the page.
 *
 * A regex-based DPI middlebox does one thing: anchor a pattern at both ends of
 * whatever crosses the wire and drop what does not match. That is the whole of
 * the FTE threat model, and until this module existed the page only asserted
 * it. Here the same rule runs against three payloads carrying the same secret —
 * the stego string, the raw AES-CTR ciphertext as hex, and that ciphertext
 * base64'd — so the reader watches two of them get flagged and one sail through.
 *
 * Two deliberate choices:
 *
 * The classifier regex is SEPARATE from the format regex. Keeping them locked
 * together would only ever produce a pass, which teaches nothing and quietly
 * overstates the guarantee. FTE's promise is conditional — it holds against a
 * classifier whose language contains the format's — and the honest way to show
 * a conditional is to let the reader break the condition. Point a stricter rule
 * at the stego string and it gets flagged, exactly as it should.
 *
 * Matching is full-string anchored with `^(?:…)$`, which is what `e2e/claims`
 * already uses to check that the stego string is a member of the language. Same
 * anchoring in both places, so the classifier cannot be accused of being a
 * friendlier judge than the test suite.
 */

import { hexToBytes } from "./ff1.ts";

export type Verdict = "pass" | "flagged";

export class ClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifierError";
  }
}

export interface Payload {
  id: string;
  /** Column heading: what the wire is carrying. */
  label: string;
  /** One line on where this payload came from. */
  provenance: string;
  value: string;
}

export interface ClassifierRow extends Payload {
  verdict: Verdict;
  /** Plain words for why, never colour alone. */
  reason: string;
}

/**
 * Compile a DPI rule. Anchored at both ends, because a middlebox rule that
 * matched a substring would accept any payload with a phone number buried
 * anywhere in it, which is a different and much weaker claim.
 */
export function compileClassifier(pattern: string): RegExp {
  if (pattern.trim().length === 0) {
    throw new ClassifierError("Enter a classifier pattern.");
  }
  try {
    return new RegExp(`^(?:${pattern})$`, "u");
  } catch (error) {
    throw new ClassifierError(`The classifier pattern is not valid: ${(error as Error).message}`);
  }
}

/** Bytes → base64, without pulling in a dependency for eight lines. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The three payloads a sender could put on the wire for one message. Same
 * ciphertext underneath all three — only the encoding differs, which is the
 * point: the classifier is reacting to shape, not to content.
 */
export function payloadsFor(stego: string, ciphertextHex: string): Payload[] {
  return [
    {
      id: "stego",
      label: "FTE stego string",
      provenance: "The ciphertext, ranked into the language and unranked back out.",
      value: stego
    },
    {
      id: "hex",
      label: "Raw ciphertext (hex)",
      provenance: "The same AES-CTR ciphertext, written as hex — what a naive tool sends.",
      value: ciphertextHex
    },
    {
      id: "base64",
      label: "Raw ciphertext (base64)",
      provenance: "The same bytes again, base64'd — the usual reflex, and no better here.",
      value: bytesToBase64(hexToBytes(ciphertextHex))
    }
  ];
}

export function classify(rule: RegExp, payloads: Payload[]): ClassifierRow[] {
  return payloads.map((payload) => {
    // A fresh lastIndex is not a concern (no /g), but re-testing the same
    // RegExp object across payloads is only safe because of that. Keep it so.
    const matched = rule.test(payload.value);
    return {
      ...payload,
      verdict: matched ? "pass" : "flagged",
      reason: matched
        ? "Matches the rule end to end — the middlebox forwards it."
        : "No full match — the middlebox drops it and logs the flow."
    };
  });
}

export interface ClassifierReading {
  rows: ClassifierRow[];
  /** True when the stego string passed and both raw encodings were flagged. */
  textbook: boolean;
  /** The headline sentence, derived from the rows rather than assumed. */
  summary: string;
}

/**
 * Read the table back as one sentence. Derived from the verdicts, never
 * hardcoded, so a classifier the reader has sharpened until it rejects the
 * stego string produces a sentence that admits it.
 */
export function readClassifier(rows: ClassifierRow[]): ClassifierReading {
  const stego = rows.find((r) => r.id === "stego");
  const raw = rows.filter((r) => r.id !== "stego");
  const rawFlagged = raw.every((r) => r.verdict === "flagged");
  const stegoPassed = stego?.verdict === "pass";
  const textbook = Boolean(stegoPassed && rawFlagged);

  let summary: string;
  if (textbook) {
    summary =
      "The stego string passed; both raw encodings of the same ciphertext were flagged. " +
      "That gap is the entire product of format-transforming encryption.";
  } else if (stegoPassed && !rawFlagged) {
    summary =
      "The stego string passed — but so did at least one raw encoding, so this rule is not " +
      "actually discriminating. Tighten it and the contrast comes back.";
  } else if (!stegoPassed && rawFlagged) {
    summary =
      "The stego string was flagged. The classifier's language no longer contains the format " +
      "you encoded into — which is the honest limit of the guarantee: FTE beats the regex it " +
      "was compiled against, not every regex.";
  } else {
    summary = "This rule flags everything, including the format itself. Nothing gets through.";
  }
  return { rows, textbook, summary };
}
