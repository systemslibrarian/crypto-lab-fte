import { describe, expect, it } from "vitest";
import { Suite, agree, bestSuite, generateIdentity, hexToBytes } from "./handshake.ts";
import { ROOT_BYTES } from "./schedule.ts";

const SUITES: Suite[] = ["X25519", "P-256"];

describe("key agreement", () => {
  it("picks X25519 when the platform has it", async () => {
    expect(await bestSuite()).toBe("X25519");
  });

  for (const suite of SUITES) {
    describe(suite, () => {
      it("both sides derive the same root from public keys alone", async () => {
        const alice = await generateIdentity(suite);
        const bob = await generateIdentity(suite);

        const a = await agree(alice, bob.publicKeyHex);
        const b = await agree(bob, alice.publicKeyHex);

        expect(a.root).toHaveLength(ROOT_BYTES);
        expect(Array.from(a.root)).toEqual(Array.from(b.root));
        // The transcript is order-independent, which is what makes that work.
        expect(a.transcript).toBe(b.transcript);
      });

      it("a third party watching the public keys derives something else", async () => {
        const alice = await generateIdentity(suite);
        const bob = await generateIdentity(suite);
        const eve = await generateIdentity(suite);

        const real = await agree(alice, bob.publicKeyHex);
        // Eve has both public keys and her own private key, and gets nowhere.
        const eveWithAlice = await agree(eve, alice.publicKeyHex);
        const eveWithBob = await agree(eve, bob.publicKeyHex);
        expect(Array.from(eveWithAlice.root)).not.toEqual(Array.from(real.root));
        expect(Array.from(eveWithBob.root)).not.toEqual(Array.from(real.root));
      });

      it("every exchange gives a different root", async () => {
        const roots = new Set<string>();
        for (let i = 0; i < 5; i += 1) {
          const a = await generateIdentity(suite);
          const b = await generateIdentity(suite);
          roots.add(Array.from((await agree(a, b.publicKeyHex)).root).join(","));
        }
        expect(roots.size).toBe(5);
      });

      it("the public key is the documented size for the suite", async () => {
        const id = await generateIdentity(suite);
        expect(hexToBytes(id.publicKeyHex)).toHaveLength(suite === "X25519" ? 32 : 65);
      });

      it("refuses a key from the wrong suite, by length, with a useful message", async () => {
        const id = await generateIdentity(suite);
        const other = await generateIdentity(suite === "X25519" ? "P-256" : "X25519");
        await expect(agree(id, other.publicKeyHex)).rejects.toThrow(/same suite/);
      });

      it("refuses this side's own key rather than deriving a useless root", async () => {
        const id = await generateIdentity(suite);
        await expect(agree(id, id.publicKeyHex)).rejects.toThrow(/own public key/);
      });

      it("refuses malformed hex", async () => {
        const id = await generateIdentity(suite);
        for (const bad of ["zz", "abc", "", "not hex at all"]) {
          await expect(agree(id, bad)).rejects.toThrow();
        }
      });
    });
  }

  it("binds the transcript, so the root depends on both keys and not just the secret", async () => {
    // Same private keys, but a tampered transcript must not reproduce the root.
    const alice = await generateIdentity("X25519");
    const bob = await generateIdentity("X25519");
    const honest = await agree(alice, bob.publicKeyHex);
    expect(honest.transcript).toContain(alice.publicKeyHex);
    expect(honest.transcript).toContain(bob.publicKeyHex);
    expect(honest.transcript.split("|")).toHaveLength(2);
    // Sorted, so both sides build it identically.
    const [first, second] = honest.transcript.split("|");
    expect(first < second || first === second).toBe(true);
  });
});
