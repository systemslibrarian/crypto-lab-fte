/**
 * Recursive-descent parser for the regex subset this lab supports.
 *
 * The subset is small on purpose. Every construct here has to survive being
 * turned into a DFA and then counted exactly, so anything that is not a regular
 * language — backreferences, lookaround — is not merely unimplemented, it is
 * outside what the construction can do at all. The parser says so by name
 * rather than failing later with something cryptic.
 *
 * Supported:
 *   literals (printable ASCII) · [abc] [a-z] [^…] · \d \w \s · .
 *   * + ? {n} {n,m} · concatenation · | · (…) · ^ and $ (ignored)
 *
 * `^` and `$` parse to epsilon: matching is always full-string, so an anchor is
 * either redundant or a lie, and the honest thing is to accept and ignore it
 * rather than pretend a partial match is on offer.
 */

import {
  CLASS_D,
  CLASS_S,
  CLASS_W,
  CharSet,
  DOT,
  complementInSigma,
  inSigma,
  normalize
} from "./alphabet.ts";

export type Ast =
  | { kind: "empty" }
  | { kind: "char"; set: CharSet }
  | { kind: "concat"; parts: Ast[] }
  | { kind: "alt"; options: Ast[] }
  | { kind: "repeat"; node: Ast; min: number; max: number };

export class RegexError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "RegexError";
    this.position = position;
  }
}

/** Upper bound on a `{n,m}` bound, per the lab's stated subset. */
export const MAX_REPEAT = 512;

const PUNCTUATION_ESCAPES = new Set(".^$*+?()[]{}|\\/-");

class Parser {
  private readonly src: string;
  private pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private eat(ch: string): boolean {
    if (this.src[this.pos] === ch) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private fail(message: string, at = this.pos): never {
    throw new RegexError(message, at);
  }

  parse(): Ast {
    const node = this.parseAlt();
    if (this.pos < this.src.length) {
      this.fail(`Unexpected '${this.src[this.pos]}' at position ${this.pos}.`);
    }
    return node;
  }

  private parseAlt(): Ast {
    const options: Ast[] = [this.parseConcat()];
    while (this.eat("|")) {
      options.push(this.parseConcat());
    }
    return options.length === 1 ? options[0] : { kind: "alt", options };
  }

  private parseConcat(): Ast {
    const parts: Ast[] = [];
    for (;;) {
      const ch = this.peek();
      if (ch === undefined || ch === "|" || ch === ")") break;
      parts.push(this.parseRepeat());
    }
    if (parts.length === 0) return { kind: "empty" };
    return parts.length === 1 ? parts[0] : { kind: "concat", parts };
  }

  private parseRepeat(): Ast {
    const atomStart = this.pos;
    let node = this.parseAtom();
    for (;;) {
      const ch = this.peek();
      if (ch === "*") {
        this.pos += 1;
        node = { kind: "repeat", node, min: 0, max: Infinity };
      } else if (ch === "+") {
        this.pos += 1;
        node = { kind: "repeat", node, min: 1, max: Infinity };
      } else if (ch === "?") {
        this.pos += 1;
        node = { kind: "repeat", node, min: 0, max: 1 };
      } else if (ch === "{") {
        const bounds = this.parseBounds(atomStart);
        node = { kind: "repeat", node, min: bounds.min, max: bounds.max };
      } else {
        break;
      }
    }
    return node;
  }

  private parseBounds(atomStart: number): { min: number; max: number } {
    const braceAt = this.pos;
    this.pos += 1; // '{'
    const digits = /[0-9]/;
    let minText = "";
    while (this.peek() !== undefined && digits.test(this.peek() as string)) {
      minText += this.src[this.pos];
      this.pos += 1;
    }
    if (minText === "") this.fail(`'{' at position ${braceAt} needs a repeat count, e.g. {3} or {1,4}.`, braceAt);
    let maxText = minText;
    if (this.eat(",")) {
      maxText = "";
      while (this.peek() !== undefined && digits.test(this.peek() as string)) {
        maxText += this.src[this.pos];
        this.pos += 1;
      }
      if (maxText === "") {
        this.fail(
          `Open-ended {n,} is not in this lab's subset — give an upper bound, e.g. {${minText},${MAX_REPEAT}}.`,
          braceAt
        );
      }
    }
    if (!this.eat("}")) this.fail(`Unclosed '{' opened at position ${braceAt}.`, braceAt);

    const min = Number(minText);
    const max = Number(maxText);
    if (max > MAX_REPEAT) {
      this.fail(`Repeat bound ${max} exceeds the maximum of ${MAX_REPEAT}.`, braceAt);
    }
    if (min > max) {
      this.fail(`Repeat bounds are inverted: {${min},${max}}.`, braceAt);
    }
    // {0} deletes the atom. Legal, and cheaper to catch here than to explain
    // later as an empty language.
    void atomStart;
    return { min, max };
  }

  private parseAtom(): Ast {
    const ch = this.peek();
    if (ch === undefined) this.fail("Pattern ended where an expression was expected.");

    if (ch === "(") {
      const open = this.pos;
      this.pos += 1;
      // Non-capturing groups parse the same way; there is no capture to record.
      if (this.src.startsWith("?:", this.pos)) this.pos += 2;
      else if (this.peek() === "?") {
        this.fail(
          `Lookaround and named groups are not regular languages this lab can count — remove the '(?' at position ${this.pos}.`,
          this.pos
        );
      }
      const inner = this.parseAlt();
      if (!this.eat(")")) this.fail(`Unclosed '(' opened at position ${open}.`, open);
      return inner;
    }

    if (ch === "[") return this.parseClass();

    if (ch === ".") {
      this.pos += 1;
      return { kind: "char", set: DOT };
    }

    if (ch === "^" || ch === "$") {
      // Full-match anchoring is implicit; an anchor contributes nothing.
      this.pos += 1;
      return { kind: "empty" };
    }

    if (ch === "\\") return { kind: "char", set: this.parseEscape() };

    if (ch === ")" || ch === "|") this.fail(`Unexpected '${ch}' at position ${this.pos}.`);
    if (ch === "*" || ch === "+" || ch === "?") {
      this.fail(`Quantifier '${ch}' at position ${this.pos} has nothing to repeat.`);
    }
    if (ch === "]" || ch === "}") {
      this.fail(`Unmatched '${ch}' at position ${this.pos} — escape it as \\${ch} for a literal.`);
    }

    const code = ch.codePointAt(0) as number;
    if (!inSigma(code) || code < 0x20) {
      this.fail(
        `Literal at position ${this.pos} is outside the alphabet (printable ASCII 0x20-0x7E).`
      );
    }
    this.pos += 1;
    return { kind: "char", set: [{ lo: code, hi: code }] };
  }

  /** `\d \w \s` plus escaped punctuation and the three control escapes. */
  private parseEscape(): CharSet {
    const at = this.pos;
    this.pos += 1; // backslash
    const ch = this.peek();
    if (ch === undefined) this.fail("Pattern ends with a dangling backslash.", at);
    this.pos += 1;

    switch (ch) {
      case "d":
        return CLASS_D;
      case "w":
        return CLASS_W;
      case "s":
        return CLASS_S;
      case "D":
        return complementInSigma(CLASS_D);
      case "W":
        return complementInSigma(CLASS_W);
      case "S":
        return complementInSigma(CLASS_S);
      case "t":
        return [{ lo: 0x09, hi: 0x09 }];
      case "n":
        return [{ lo: 0x0a, hi: 0x0a }];
      default:
        break;
    }
    if (PUNCTUATION_ESCAPES.has(ch)) {
      const code = ch.codePointAt(0) as number;
      return [{ lo: code, hi: code }];
    }
    // A backreference is the one rejection worth naming on its own. It is not a
    // gap in this parser: a language with a backreference is not regular, so no
    // DFA recognizes it and no count table can size it. Saying "\\1 is not in the
    // subset" would suggest it could be added.
    if (ch >= "1" && ch <= "9") {
      this.fail(
        `Backreference '\\${ch}' at position ${at}: a language with a backreference is not regular, ` +
          `so it has no DFA and no exact count. This construction cannot support one at any size.`,
        at
      );
    }
    this.fail(
      `Escape '\\${ch}' at position ${at} is not in this lab's subset (\\d \\w \\s \\D \\W \\S \\t \\n and escaped punctuation).`,
      at
    );
  }

  private parseClass(): Ast {
    const open = this.pos;
    this.pos += 1; // '['
    const negated = this.eat("^");
    const parts: CharSet = [];
    let first = true;

    for (;;) {
      const ch = this.peek();
      if (ch === undefined) this.fail(`Unclosed '[' opened at position ${open}.`, open);
      if (ch === "]" && !first) {
        this.pos += 1;
        break;
      }
      first = false;

      // A ']' immediately after '[' or '[^' is a literal, as in POSIX.
      let lowSet: CharSet;
      if (ch === "\\") {
        lowSet = this.parseEscape();
      } else {
        const code = ch.codePointAt(0) as number;
        if (!inSigma(code)) {
          this.fail(`Character in class at position ${this.pos} is outside the alphabet.`);
        }
        this.pos += 1;
        lowSet = [{ lo: code, hi: code }];
      }

      // A range needs a single-character left side and a '-' not at the end.
      if (this.peek() === "-" && this.src[this.pos + 1] !== "]" && this.pos + 1 < this.src.length) {
        if (lowSet.length !== 1 || lowSet[0].lo !== lowSet[0].hi) {
          this.fail(`A range cannot start with a character class at position ${this.pos}.`);
        }
        this.pos += 1; // '-'
        const hiCh = this.peek();
        if (hiCh === undefined) this.fail(`Unclosed '[' opened at position ${open}.`, open);
        let hiSet: CharSet;
        if (hiCh === "\\") {
          hiSet = this.parseEscape();
        } else {
          const code = hiCh.codePointAt(0) as number;
          if (!inSigma(code)) {
            this.fail(`Character in class at position ${this.pos} is outside the alphabet.`);
          }
          this.pos += 1;
          hiSet = [{ lo: code, hi: code }];
        }
        if (hiSet.length !== 1 || hiSet[0].lo !== hiSet[0].hi) {
          this.fail(`A range cannot end with a character class at position ${this.pos}.`);
        }
        if (hiSet[0].lo < lowSet[0].lo) {
          this.fail(
            `Range is reversed at position ${this.pos}: '${String.fromCodePoint(lowSet[0].lo)}-${String.fromCodePoint(hiSet[0].lo)}'.`
          );
        }
        parts.push({ lo: lowSet[0].lo, hi: hiSet[0].lo });
        continue;
      }

      parts.push(...lowSet);
    }

    const set = normalize(parts);
    if (set.length === 0) this.fail(`Empty character class at position ${open}.`, open);
    const final = negated ? complementInSigma(set) : set;
    if (final.length === 0) {
      this.fail(`Negated class at position ${open} excludes the whole alphabet — it matches nothing.`, open);
    }
    return { kind: "char", set: final };
  }
}

export function parseRegex(pattern: string): Ast {
  if (pattern.length === 0) throw new RegexError("Pattern is empty.", 0);
  return new Parser(pattern).parse();
}
