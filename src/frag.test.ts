import { describe, expect, it } from "vitest";
import { AuthError, CapacityError } from "./aead.ts";
import { compileFormat } from "./fte.ts";
import { MAX_FRAGMENTS, openFragments, plan, sealFragments } from "./frag.ts";
import { deriveRoot } from "./schedule.ts";

const PHONE = "\\(\\d{3}\\) \\d{3}-\\d{4}";
const HEX = "[0-9a-f]{32}";

let cached: Uint8Array | null = null;
async function root(): Promise<Uint8Array> {
  if (!cached) cached = await deriveRoot("correct horse battery staple");
  return cached;
}

describe("planning the fragments", () => {
  it("a 16-byte message with a 128-bit tag needs twelve phone numbers", () => {
    const p = plan(33, 16, 16);
    expect(p.payloadBytes).toBe(4);
    expect(p.firstChunk).toBe(2);
    expect(p.restChunk).toBe(3);
    expect(p.blobBytes).toBe(2 + 16 + 16);
    expect(p.fragments).toBe(12);
    expect(p.fits).toBe(true);
  });

  it("the plan holds the blob it claims to hold", () => {
    for (const capacity of [33, 39, 128, 384]) {
      for (const tag of [16, 8, 4] as const) {
        for (const len of [1, 5, 16, 50]) {
          const p = plan(capacity, tag, len);
          if (!p.fits) continue;
          const room = p.firstChunk + (p.fragments - 1) * p.restChunk;
          expect(room, `capacity=${capacity} tag=${tag} len=${len}`).toBeGreaterThanOrEqual(p.blobBytes);
          // And one fragment fewer would NOT hold it — the plan is tight.
          if (p.fragments > 1) {
            expect(room - p.restChunk).toBeLessThan(p.blobBytes);
          }
        }
      }
    }
  });

  it("a format with no room after the frame byte and the count refuses", () => {
    const p = plan(8, 4, 1);
    expect(p.fits).toBe(false);
    expect(p.reason).toContain("Nothing is left to fragment");
  });

  it("refuses a message that would need more fragments than the count can express", () => {
    const p = plan(33, 16, 5000);
    expect(p.fits).toBe(false);
    expect(p.reason).toContain(String(MAX_FRAGMENTS));
  });
});

describe("sealing and opening across fragments", () => {
  it("carries an authenticated message in phone numbers, which one string cannot", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "meet me at six", tagBytes: 16
    });

    expect(sealed.strings.length).toBe(sealed.plan.fragments);
    const anchored = new RegExp(`^(?:${PHONE})$`);
    for (const s of sealed.strings) expect(anchored.test(s), s).toBe(true);

    const opened = await openFragments(format, sealed.strings, await root(), 0, 16, 8);
    expect(opened.message).toBe("meet me at six");
    expect(opened.fragments).toBe(sealed.plan.fragments);
  });

  it("round trips a range of lengths and tag sizes", async () => {
    const format = compileFormat(PHONE);
    for (const message of ["a", "hello", "a slightly longer one"]) {
      for (const tagBytes of [16, 8, 4] as const) {
        const sealed = await sealFragments({
          format, n: 14, root: await root(), baseCounter: 2, message, tagBytes
        });
        const opened = await openFragments(format, sealed.strings, await root(), 0, tagBytes, 8);
        expect(opened.message, `${message} @ ${tagBytes}`).toBe(message);
        expect(opened.baseCounter).toBe(2);
      }
    }
  });

  it("a single fragment is used when the message fits in one string", async () => {
    const format = compileFormat(HEX);
    const sealed = await sealFragments({
      format, n: 32, root: await root(), baseCounter: 0, message: "hi", tagBytes: 4
    });
    expect(sealed.plan.fragments).toBe(1);
    expect(await openFragments(format, sealed.strings, await root(), 0, 4, 4)).toMatchObject({
      message: "hi"
    });
  });

  it("every fragment is a distinct member of the language", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "abcdefghij", tagBytes: 8
    });
    expect(new Set(sealed.strings).size).toBe(sealed.strings.length);
  });

  it("resynchronises to a base counter it was not told", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 5, message: "found me", tagBytes: 8
    });
    const opened = await openFragments(format, sealed.strings, await root(), 0, 8, 16);
    expect(opened.baseCounter).toBe(5);
    expect(opened.message).toBe("found me");
  });
});

describe("fragments are authenticated as one message", () => {
  it("tampering with any single fragment fails the whole message", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "do not tamper", tagBytes: 8
    });

    for (let i = 0; i < sealed.strings.length; i += 1) {
      const swapped = [...sealed.strings];
      // Replace one fragment with a different, perfectly valid phone number.
      const other = await sealFragments({
        format, n: 14, root: await root(), baseCounter: 90, message: "x", tagBytes: 8
      });
      swapped[i] = other.strings[0];
      await expect(
        openFragments(format, swapped, await root(), 0, 8, 8),
        `fragment ${i}`
      ).rejects.toThrow(AuthError);
    }
  });

  it("reordering fragments fails", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "order matters", tagBytes: 8
    });
    const shuffled = [...sealed.strings];
    [shuffled[1], shuffled[2]] = [shuffled[2], shuffled[1]];
    await expect(openFragments(format, shuffled, await root(), 0, 8, 8)).rejects.toThrow(AuthError);
  });

  it("dropping a fragment fails", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "all of it", tagBytes: 8
    });
    await expect(
      openFragments(format, sealed.strings.slice(0, -1), await root(), 0, 8, 8)
    ).rejects.toThrow(AuthError);
  });

  it("a wrong root fails", async () => {
    const format = compileFormat(PHONE);
    const sealed = await sealFragments({
      format, n: 14, root: await root(), baseCounter: 0, message: "secret", tagBytes: 8
    });
    const wrong = await deriveRoot("not the passphrase");
    await expect(openFragments(format, sealed.strings, wrong, 0, 8, 8)).rejects.toThrow(AuthError);
  });

  it("refuses to seal what it cannot plan", async () => {
    const format = compileFormat(PHONE);
    await expect(
      sealFragments({
        format, n: 14, root: await root(), baseCounter: 0, message: "x".repeat(2000), tagBytes: 16
      })
    ).rejects.toThrow(CapacityError);
  });
});
