import { describe, expect, it } from "vitest";
import { assertNoSecrets, decodeState, encodeState } from "./share.ts";

const STATE = {
  preset: "phone",
  pattern: "\\(\\d{3}\\) \\d{3}-\\d{4}",
  n: 14,
  message: "hi"
};

describe("shareable state", () => {
  it("round trips every field, including regex metacharacters", () => {
    const fragment = encodeState({ ...STATE, classifier: "\\d+", step: 3 });
    expect(decodeState(fragment)).toEqual({ ...STATE, classifier: "\\d+", step: 3 });
  });

  it("round trips through a leading # the way location.hash hands it over", () => {
    expect(decodeState(`#${encodeState(STATE)}`)).toEqual(STATE);
  });

  it("omits optional fields rather than writing empty ones", () => {
    const decoded = decodeState(encodeState(STATE));
    expect("classifier" in decoded).toBe(false);
    expect("step" in decoded).toBe(false);
  });

  it("survives a hostile fragment without throwing, and applies nothing bad", () => {
    for (const junk of [
      "",
      "#",
      "%%%%",
      "n=-1",
      "n=abc",
      "n=1e309",
      "n=1.5",
      "step=-4",
      "__proto__=polluted",
      "pattern",
      "&&&&==="
    ]) {
      expect(() => decodeState(junk)).not.toThrow();
      const decoded = decodeState(junk) as Record<string, unknown>;
      expect(decoded.n).toBeUndefined();
      expect(decoded.step).toBeUndefined();
    }
    // Prototype pollution attempt lands nowhere.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("drops keys that are not part of the allowed set", () => {
    const decoded = decodeState("preset=phone&passphrase=hunter2&salt=abcd") as Record<string, unknown>;
    expect(decoded.preset).toBe("phone");
    expect(decoded.passphrase).toBeUndefined();
    expect(decoded.salt).toBeUndefined();
  });

  it("drops absurdly long fields instead of pasting them into the page", () => {
    const decoded = decodeState(`pattern=${"a".repeat(5000)}`);
    expect(decoded.pattern).toBeUndefined();
  });

  it("refuses to write a fragment containing key material", () => {
    const fragment = encodeState({ ...STATE, message: "my passphrase is hunter2" });
    expect(() => assertNoSecrets(fragment, ["hunter2"])).toThrow(/key material/);
    expect(() => assertNoSecrets(fragment, ["something-else"])).not.toThrow();
  });

  it("catches key material regardless of case or percent-encoding", () => {
    const fragment = encodeState({ ...STATE, message: "HUNTER2" });
    expect(() => assertNoSecrets(fragment, ["hunter2"])).toThrow();
    const encoded = encodeState({ ...STATE, message: "a b/c+d" });
    expect(() => assertNoSecrets(encoded, ["a b/c+d"])).toThrow();
  });

  it("ignores empty secrets, which would otherwise match everything", () => {
    expect(() => assertNoSecrets(encodeState(STATE), ["", ""])).not.toThrow();
  });
});
