import { describe, expect, it } from "vitest";
import { parseRegex } from "./regex/parser.ts";
import { buildNfa } from "./regex/nfa.ts";
import { buildDfa, stepSymbol } from "./regex/dfa.ts";
import {
  NotInLanguageError,
  buildCountTable,
  capacityBitsOf,
  rank,
  scanCapacity,
  smallestLengthFor,
  unrank
} from "./rank.ts";

function compile(pattern: string) {
  return buildDfa(buildNfa(parseRegex(pattern)));
}

function inLanguage(dfa: ReturnType<typeof compile>, text: string): boolean {
  let q = dfa.start;
  for (const ch of text) {
    q = stepSymbol(dfa, q, ch.codePointAt(0) as number);
    if (q < 0) return false;
  }
  return dfa.accepting[q];
}

describe("count table", () => {
  it("counts what a brute-force enumeration counts", () => {
    // Small enough to enumerate every string over the two letters involved.
    const dfa = compile("(ab|ba)+");
    const table = buildCountTable(dfa, 6);
    for (let n = 0; n <= 6; n += 1) {
      let brute = 0;
      const letters = ["a", "b"];
      const walk = (prefix: string): void => {
        if (prefix.length === n) {
          if (inLanguage(dfa, prefix)) brute += 1;
          return;
        }
        for (const l of letters) walk(prefix + l);
      };
      walk("");
      expect(table.rows[n][dfa.start], `n=${n}`).toBe(BigInt(brute));
    }
  });

  it("gets the textbook sizes right", () => {
    expect(buildCountTable(compile("[0-9a-f]{32}"), 32).total).toBe(16n ** 32n);
    expect(buildCountTable(compile("[A-Za-z0-9+/]{64}"), 64).total).toBe(64n ** 64n);
    expect(buildCountTable(compile("\\(\\d{3}\\) \\d{3}-\\d{4}"), 14).total).toBe(10n ** 10n);
    // IPv4 dotted quad with \d{1,3} octets: 1110 spellings per octet at any
    // length, but the total is over all four octets at a fixed n — so check the
    // sum across lengths instead, which is (10 + 100 + 1000)^4.
    const ip = compile("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    const counts = scanCapacity(ip, 15);
    const totalAllLengths = counts.reduce((a, b) => a + b, 0n);
    expect(totalAllLengths).toBe(1110n ** 4n);
  });

  it("capacity is floor(log2 N)", () => {
    expect(capacityBitsOf(1n)).toBe(0);
    expect(capacityBitsOf(2n)).toBe(1);
    expect(capacityBitsOf(255n)).toBe(7);
    expect(capacityBitsOf(256n)).toBe(8);
    expect(capacityBitsOf(10n ** 10n)).toBe(33); // the phone-number preset
    expect(capacityBitsOf(16n ** 32n)).toBe(128); // the hex preset
    expect(capacityBitsOf(64n ** 64n)).toBe(384); // the base64 preset
  });

  it("scanCapacity and buildCountTable agree at every length", () => {
    const dfa = compile("(cat|dog|emu)+");
    const counts = scanCapacity(dfa, 12);
    for (let n = 0; n <= 12; n += 1) {
      expect(buildCountTable(dfa, n).total, `n=${n}`).toBe(counts[n]);
    }
  });
});

describe("rank / unrank", () => {
  it("is a bijection onto [0, N): enumerating it reproduces the language, in order", () => {
    const dfa = compile("(ab|ba|aa)+");
    const table = buildCountTable(dfa, 4);
    const seen: string[] = [];
    for (let i = 0n; i < table.total; i += 1n) {
      const s = unrank(dfa, table, i);
      expect(s).toHaveLength(4);
      expect(inLanguage(dfa, s)).toBe(true);
      expect(rank(dfa, table, s)).toBe(i);
      seen.push(s);
    }
    expect(new Set(seen).size).toBe(Number(table.total));
    // Canonical order: the enumeration is sorted.
    expect(seen).toEqual([...seen].sort());
  });

  it("round-trips at the far ends of a large domain", () => {
    const dfa = compile("[A-Za-z0-9+/]{64}");
    const table = buildCountTable(dfa, 64);
    for (const i of [0n, 1n, table.total / 3n, table.total - 1n]) {
      const s = unrank(dfa, table, i);
      expect(s).toHaveLength(64);
      expect(rank(dfa, table, s)).toBe(i);
    }
    // Order is by CODE POINT, not by base64's own alphabet order: '+' is 0x2B
    // and 'z' is 0x7A, so index 0 is all-plus and index N-1 is all-z. The
    // difference is exactly why the ranking defines its own order rather than
    // inheriting one from the format.
    expect(unrank(dfa, table, 0n)).toBe("+".repeat(64));
    expect(unrank(dfa, table, table.total - 1n)).toBe("z".repeat(64));
  });

  it("ranks a real phone number to the digits it spells", () => {
    const dfa = compile("\\(\\d{3}\\) \\d{3}-\\d{4}");
    const table = buildCountTable(dfa, 14);
    expect(rank(dfa, table, "(415) 555-0123")).toBe(4155550123n);
    expect(unrank(dfa, table, 4155550123n)).toBe("(415) 555-0123");
    expect(unrank(dfa, table, 0n)).toBe("(000) 000-0000");
  });

  it("refuses strings the pattern does not accept", () => {
    const dfa = compile("[0-9a-f]{4}");
    const table = buildCountTable(dfa, 4);
    expect(() => rank(dfa, table, "dead")).not.toThrow();
    expect(() => rank(dfa, table, "DEAD")).toThrow(NotInLanguageError);
    expect(() => rank(dfa, table, "dea")).toThrow(NotInLanguageError);
    expect(() => rank(dfa, table, "deadb")).toThrow(NotInLanguageError);
    expect(() => rank(dfa, table, "deéd")).toThrow(NotInLanguageError);
  });

  it("refuses an index outside [0, N)", () => {
    const dfa = compile("[01]{20}");
    const table = buildCountTable(dfa, 20);
    expect(() => unrank(dfa, table, table.total)).toThrow(RangeError);
    expect(() => unrank(dfa, table, -1n)).toThrow(RangeError);
  });

  it("handles a variable-length language at a fixed n", () => {
    const dfa = compile("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    const table = buildCountTable(dfa, 15); // 3.3.3.3 dotted quad, the longest
    expect(table.total).toBe(1000n ** 4n);
    const s = unrank(dfa, table, 123456789012n);
    expect(new RegExp("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$").test(s)).toBe(true);
    expect(rank(dfa, table, s)).toBe(123456789012n);
  });
});

describe("length selection", () => {
  it("finds the shortest n that holds a payload", () => {
    const counts = scanCapacity(compile("[0-9a-f]{1,64}"), 64);
    const fit = smallestLengthFor(counts, 128);
    expect(fit?.n).toBe(32); // 16^32 = 2^128
    expect(smallestLengthFor(counts, 8)?.n).toBe(2);
    expect(smallestLengthFor(counts, 100_000)).toBeNull();
  });
});
