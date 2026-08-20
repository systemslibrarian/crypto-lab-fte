/**
 * The nine sample vectors NIST published alongside SP 800-38G, as data.
 *
 * They live here rather than inside `ff1.test.ts` because the page runs them
 * too. A visitor's whole reason to believe the words "real FF1" is that the
 * nine known answers come out right, and asking them to clone the repo to see
 * that is asking them to take it on trust. The Sources panel runs this list in
 * the browser and prints what it got beside what NIST says.
 *
 * One list, two consumers: if a vector is ever edited to make a failing test
 * pass, the page starts printing the edited expectation too, which is a much
 * louder failure than a green suite.
 */

import { ff1Decrypt, ff1Encrypt, hexToBytes, importFf1Key } from "./ff1.ts";

export const RADIX10 = "0123456789";
export const RADIX36 = "0123456789abcdefghijklmnopqrstuvwxyz";

const K128 = "2b7e151628aed2a6abf7158809cf4f3c";
const K192 = "2b7e151628aed2a6abf7158809cf4f3cef4359d8d580aa4f";
const K256 = "2b7e151628aed2a6abf7158809cf4f3cef4359d8d580aa4f7f036d6f04fc6a94";
const TW = "39383736353433323130";
const TW36 = "3737373770717273373737";
const PT10 = "0123456789";
const PT36 = "0123456789abcdefghi";

export interface Ff1Vector {
  /** NIST's own sample number, e.g. "Sample 1". */
  name: string;
  keyHex: string;
  /** 128, 192 or 256 — derived from the key, stated for the table. */
  keyBits: number;
  radix: number;
  alphabet: string;
  plaintext: string;
  tweakHex: string;
  expected: string;
}

export const FF1_VECTORS: Ff1Vector[] = [
  { name: "Sample 1", keyHex: K128, keyBits: 128, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: "", expected: "2433477484" },
  { name: "Sample 2", keyHex: K128, keyBits: 128, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: TW, expected: "6124200773" },
  { name: "Sample 3", keyHex: K128, keyBits: 128, radix: 36, alphabet: RADIX36, plaintext: PT36, tweakHex: TW36, expected: "a9tv40mll9kdu509eum" },
  { name: "Sample 4", keyHex: K192, keyBits: 192, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: "", expected: "2830668132" },
  { name: "Sample 5", keyHex: K192, keyBits: 192, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: TW, expected: "2496655549" },
  { name: "Sample 6", keyHex: K192, keyBits: 192, radix: 36, alphabet: RADIX36, plaintext: PT36, tweakHex: TW36, expected: "xbj3kv35jrawxv32ysr" },
  { name: "Sample 7", keyHex: K256, keyBits: 256, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: "", expected: "6657667009" },
  { name: "Sample 8", keyHex: K256, keyBits: 256, radix: 10, alphabet: RADIX10, plaintext: PT10, tweakHex: TW, expected: "1001623463" },
  { name: "Sample 9", keyHex: K256, keyBits: 256, radix: 36, alphabet: RADIX36, plaintext: PT36, tweakHex: TW36, expected: "xs8a0azh2avyalyzuwd" }
];

export function toSymbols(text: string, alphabet: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (ch) => alphabet.indexOf(ch)));
}

export function fromSymbols(symbols: Uint8Array, alphabet: string): string {
  return Array.from(symbols, (s) => alphabet[s]).join("");
}

/**
 * `unsupported` is not a failure, and conflating the two would be a lie in the
 * loud direction.
 *
 * WebCrypto has no AES-192. The spec never included it, and no browser
 * implements it, so `importKey` rejects a 24-byte AES key outright — which
 * takes samples 4, 5 and 6 off the table in any browser while leaving them
 * perfectly runnable under Node, whose WebCrypto does implement it.
 *
 * That asymmetry is worth knowing and easy to miss: a CI suite running on Node
 * goes green on all nine and tells you nothing about what a visitor's browser
 * can actually reproduce. The in-page runner is what surfaced it. So the table
 * shows all nine, runs the six it can, and says plainly why the other three are
 * blank — rather than printing FAIL against an implementation that is correct.
 */
export type VectorStatus = "pass" | "fail" | "unsupported";

export interface VectorRun {
  vector: Ff1Vector;
  /** What this implementation produced, or "" when the platform refused. */
  actual: string;
  /** The decrypt leg: FF1⁻¹(FF1(x)) must be x, checked separately from the KAT. */
  roundTrip: string;
  pass: boolean;
  status: VectorStatus;
  /** Plain words for the table's last column. */
  note: string;
}

/**
 * Distinguish "this platform cannot even hold the key" from "the answer came
 * out wrong". Only the second is a defect in this code.
 */
function isUnsupportedKey(error: unknown, vector: Ff1Vector): boolean {
  if (vector.keyBits !== 192) return false;
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes("192") ||
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("operation is not supported")
  );
}

/**
 * Run one vector both ways. Encrypt must equal NIST's ciphertext AND decrypt
 * must return the plaintext — a table that only checked encryption would go
 * green for an implementation whose inverse was broken.
 */
export async function runVector(vector: Ff1Vector): Promise<VectorRun> {
  let key: CryptoKey;
  try {
    key = await importFf1Key(hexToBytes(vector.keyHex));
  } catch (error) {
    if (isUnsupportedKey(error, vector)) {
      return {
        vector,
        actual: "",
        roundTrip: "",
        pass: false,
        status: "unsupported",
        note: "AES-192 — WebCrypto does not implement it, so no browser can run this one. Covered by the Node test suite."
      };
    }
    throw error;
  }

  const tweak = hexToBytes(vector.tweakHex);
  const ct = await ff1Encrypt(key, vector.radix, toSymbols(vector.plaintext, vector.alphabet), tweak);
  const actual = fromSymbols(ct, vector.alphabet);
  const back = await ff1Decrypt(key, vector.radix, ct, tweak);
  const roundTrip = fromSymbols(back, vector.alphabet);
  const pass = actual === vector.expected && roundTrip === vector.plaintext;
  return {
    vector,
    actual,
    roundTrip,
    pass,
    status: pass ? "pass" : "fail",
    note: pass
      ? "Ciphertext matches NIST, and decryption returns the plaintext."
      : "Does NOT match SP 800-38G."
  };
}

export async function runAllVectors(): Promise<VectorRun[]> {
  const runs: VectorRun[] = [];
  for (const vector of FF1_VECTORS) runs.push(await runVector(vector));
  return runs;
}

export interface VectorTally {
  passed: number;
  failed: number;
  unsupported: number;
  total: number;
}

export function tally(runs: VectorRun[]): VectorTally {
  return {
    passed: runs.filter((r) => r.status === "pass").length,
    failed: runs.filter((r) => r.status === "fail").length,
    unsupported: runs.filter((r) => r.status === "unsupported").length,
    total: runs.length
  };
}
