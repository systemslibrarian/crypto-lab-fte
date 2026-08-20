import { describe, expect, it } from "vitest";
import { AuthError, CapacityError, budget, open, pad, seal, unpad } from "./aead.ts";
import { compileFormat } from "./fte.ts";
import { deriveRoot } from "./schedule.ts";

const BASE64 = "[A-Za-z0-9+/]{64}";
const HEX = "[0-9a-f]{32}";
const PHONE = "\\(\\d{3}\\) \\d{3}-\\d{4}";

/** PBKDF2 once for the whole file — that is the point of the new schedule. */
let cachedRoot: Uint8Array | null = null;
async function root(): Promise<Uint8Array> {
  if (!cachedRoot) cachedRoot = await deriveRoot("correct horse battery staple");
  return cachedRoot;
}

describe("the capacity budget decides whether the mode can run", () => {
  it("a phone number cannot carry an authenticated message at any offered tag size", () => {
    for (const t of [16, 8, 4] as const) {
      expect(budget(33, t).fits).toBe(false);
    }
  });

  it("hex fits only the shorter tags, base64 fits them all", () => {
    expect(budget(128, 16).fits).toBe(false);
    expect(budget(128, 8)).toMatchObject({ fits: true, plaintextBytes: 7, maxMessageBytes: 6 });
    expect(budget(128, 4)).toMatchObject({ fits: true, plaintextBytes: 11, maxMessageBytes: 10 });
    expect(budget(384, 16)).toMatchObject({ fits: true, plaintextBytes: 31, maxMessageBytes: 30 });
  });

  it("states the forgery bound the chosen tag actually gives", () => {
    expect(budget(384, 16).forgeryBits).toBe(128);
    expect(budget(384, 4).forgeryBits).toBe(32);
  });
});

describe("padding is fixed-size, which is what stops the length leaking", () => {
  it("every message of every length produces the same block", () => {
    for (let len = 0; len <= 10; len += 1) {
      const padded = pad(new Uint8Array(len).fill(0x41), 11);
      expect(padded).toHaveLength(11);
      expect(unpad(padded)).toHaveLength(len);
    }
  });

  it("refuses a message that would overflow the block, and says by how much", () => {
    expect(() => pad(new Uint8Array(11), 11)).toThrow(CapacityError);
  });
});

describe("seal and open", () => {
  it("round trips, with nothing but the stego string on the wire", async () => {
    const format = compileFormat(BASE64);
    const sealed = await seal({
      format, n: 64, root: await root(), counter: 0, message: "meet at six", tagBytes: 16
    });
    expect(new RegExp(`^(?:${BASE64})$`).test(sealed.stego)).toBe(true);
    const opened = await open(format, sealed.stego, await root(), 0, 16);
    expect(opened.message).toBe("meet at six");
    expect(opened.counter).toBe(0);
  });

  it("the wire length is identical whatever the message length is", async () => {
    const format = compileFormat(BASE64);
    const lengths = new Set<number>();
    for (const message of ["a", "ab", "hello world", "x".repeat(30)]) {
      const sealed = await seal({
        format, n: 64, root: await root(), counter: 3, message, tagBytes: 16
      });
      lengths.add(sealed.stego.length);
      expect(sealed.trace.ciphertextHex).toHaveLength(sealed.budget.plaintextBytes * 2);
    }
    expect(lengths.size).toBe(1);
  });

  it("n is never grown — an over-long message is refused instead", async () => {
    const format = compileFormat(BASE64);
    await expect(
      seal({ format, n: 64, root: await root(), counter: 0, message: "x".repeat(31), tagBytes: 16 })
    ).rejects.toThrow(CapacityError);
  });

  it("refuses a format too narrow for a tag, naming the arithmetic", async () => {
    const format = compileFormat(PHONE);
    await expect(
      seal({ format, n: 14, root: await root(), counter: 0, message: "hi", tagBytes: 4 })
    ).rejects.toThrow(/does not fit|frame byte/);
  });

  it("the same message under successive counters gives different strings", async () => {
    const format = compileFormat(HEX);
    const seen = new Set<string>();
    for (let counter = 0; counter < 5; counter += 1) {
      const sealed = await seal({
        format, n: 32, root: await root(), counter, message: "abc", tagBytes: 8
      });
      seen.add(sealed.stego);
    }
    // The ratchet makes every message key independent, so no repeats.
    expect(seen.size).toBe(5);
  });

  it("resynchronises across a gap without being told the counter", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 9, message: "gap", tagBytes: 8
    });
    // The receiver believes it is at 0 and finds 9 by searching forward.
    const opened = await open(format, sealed.stego, await root(), 0, 8, 32);
    expect(opened.message).toBe("gap");
    expect(opened.counter).toBe(9);
    expect(opened.searched).toBe(10);
  });

  it("gives up when the counter is past the window", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 40, message: "far", tagBytes: 8
    });
    await expect(open(format, sealed.stego, await root(), 0, 8, 8)).rejects.toThrow(AuthError);
  });
});

describe("authentication", () => {
  it("rejects every substitution — the attack the unauthenticated mode cannot stop", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 0, message: "secret", tagBytes: 8
    });
    const alphabet = "0123456789abcdef";
    let rejected = 0;
    for (let i = 0; i < 40; i += 1) {
      const chars = Array.from(sealed.stego);
      chars[i % chars.length] = alphabet[(alphabet.indexOf(chars[i % chars.length]) + 1) % 16];
      await expect(open(format, chars.join(""), await root(), 0, 8)).rejects.toThrow(AuthError);
      rejected += 1;
    }
    expect(rejected).toBe(40);
  });

  it("rejects a wholly different member of the language", async () => {
    const format = compileFormat(HEX);
    await expect(open(format, "0".repeat(32), await root(), 0, 8)).rejects.toThrow(AuthError);
  });

  it("rejects a wrong passphrase", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 0, message: "secret", tagBytes: 8
    });
    const wrong = await deriveRoot("not the passphrase");
    await expect(open(format, sealed.stego, wrong, 0, 8)).rejects.toThrow(AuthError);
  });

  /**
   * Item 2. The unauthenticated decoder tells you WHICH check refused you —
   * "no frame marker" versus "not valid UTF-8" — which is a two-state oracle.
   * Here every refusal must be the same object with the same words, whatever
   * caused it, or the oracle is back.
   */
  it("every rejection is byte-identical, whatever caused it", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 0, message: "secret", tagBytes: 8
    });
    const wrong = await deriveRoot("not the passphrase");

    const good = await root();
    const failures = [
      () => open(format, "0".repeat(32), good, 0, 8),          // a different language member
      () => open(format, sealed.stego, wrong, 0, 8),           // wrong key
      () => open(format, sealed.stego, good, 900, 8, 4),       // counter past the window
      () => open(format, "zz" + "0".repeat(30), good, 0, 8),   // outside the alphabet
      () => open(format, "0".repeat(31), good, 0, 8),          // wrong length
      () => open(format, sealed.stego, good, 0, 4)             // wrong tag size
    ];

    const messages = new Set<string>();
    const names = new Set<string>();
    for (const attempt of failures) {
      await attempt().then(
        () => { throw new Error("a failure case unexpectedly succeeded"); },
        (error: Error) => { messages.add(error.message); names.add(error.name); }
      );
    }
    expect(names).toEqual(new Set(["AuthError"]));
    expect(messages.size, `distinct refusal messages: ${[...messages].join(" | ")}`).toBe(1);
  });
});

describe("freshness", () => {
  it("a replayed string is refused, with the same error as a forgery", async () => {
    const { accept, createWindow } = await import("./replay.ts");
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 3, message: "once", tagBytes: 8
    });

    let win = createWindow();
    const first = await open(format, sealed.stego, await root(), 0, 8, 32, win);
    expect(first.message).toBe("once");
    win = accept(win, first.counter);

    // The tag still verifies — it is the same tag. Only freshness rejects it.
    await expect(open(format, sealed.stego, await root(), 0, 8, 32, win)).rejects.toThrow(AuthError);
  });

  it("without a window, a replay is happily accepted — which is the point", async () => {
    const format = compileFormat(HEX);
    const sealed = await seal({
      format, n: 32, root: await root(), counter: 3, message: "once", tagBytes: 8
    });
    for (let i = 0; i < 3; i += 1) {
      expect((await open(format, sealed.stego, await root(), 0, 8, 32)).message).toBe("once");
    }
  });
});
