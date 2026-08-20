import { describe, expect, it } from "vitest";
import {
  ClassifierError,
  bytesToBase64,
  classify,
  compileClassifier,
  payloadsFor,
  readClassifier
} from "./classifier.ts";

const PHONE = "\\(\\d{3}\\) \\d{3}-\\d{4}";

describe("the DPI classifier", () => {
  it("anchors at both ends, so a buried match is not a match", () => {
    const rule = compileClassifier(PHONE);
    expect(rule.test("(905) 263-5403")).toBe(true);
    expect(rule.test("call (905) 263-5403 now")).toBe(false);
  });

  it("refuses an invalid pattern with a named error rather than throwing raw", () => {
    expect(() => compileClassifier("(unclosed")).toThrow(ClassifierError);
    expect(() => compileClassifier("   ")).toThrow(ClassifierError);
  });

  it("passes the stego string and flags both raw encodings of the same bytes", () => {
    const rule = compileClassifier(PHONE);
    const rows = classify(rule, payloadsFor("(905) 263-5403", "9f2b41c8"));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.verdict]));
    expect(byId.stego).toBe("pass");
    expect(byId.hex).toBe("flagged");
    expect(byId.base64).toBe("flagged");
    expect(readClassifier(rows).textbook).toBe(true);
  });

  it("admits it when a sharpened rule flags the stego string too", () => {
    // Same format, but only area codes starting 9 — a language the phone
    // preset's slice is NOT contained in.
    const rule = compileClassifier("\\(9\\d{2}\\) \\d{3}-\\d{4}");
    const rows = classify(rule, payloadsFor("(105) 263-5403", "9f2b41c8"));
    const reading = readClassifier(rows);
    expect(rows.find((r) => r.id === "stego")?.verdict).toBe("flagged");
    expect(reading.textbook).toBe(false);
    expect(reading.summary).toContain("honest limit");
  });

  it("calls out a rule so loose that the raw ciphertext also passes", () => {
    const rows = classify(compileClassifier(".*"), payloadsFor("(905) 263-5403", "9f2b41c8"));
    const reading = readClassifier(rows);
    expect(reading.textbook).toBe(false);
    expect(reading.summary).toContain("not actually discriminating");
  });

  it("all three payloads carry the same ciphertext bytes", () => {
    const rows = payloadsFor("(905) 263-5403", "deadbeef");
    expect(rows.find((r) => r.id === "hex")?.value).toBe("deadbeef");
    expect(rows.find((r) => r.id === "base64")?.value).toBe(bytesToBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef])));
  });

  it("base64 matches the platform encoder on a byte range that exercises padding", () => {
    for (const length of [1, 2, 3, 4, 5, 16, 31]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      const expected = btoa(String.fromCharCode(...bytes));
      expect(bytesToBase64(bytes)).toBe(expected);
    }
  });

  it("re-testing one compiled rule across payloads is order-independent", () => {
    const rule = compileClassifier(PHONE);
    const payloads = payloadsFor("(905) 263-5403", "9f2b41c8");
    const forward = classify(rule, payloads).map((r) => r.verdict);
    const backward = classify(rule, [...payloads].reverse()).map((r) => r.verdict).reverse();
    expect(forward).toEqual(backward);
  });
});
