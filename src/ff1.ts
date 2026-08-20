/**
 * FF1 (NIST SP 800-38G §5.2), plus cycle-walking to reach an arbitrary domain.
 *
 * FF1 is a 10-round Feistel network whose round function is AES-CBC-MAC over a
 * formatted block. It permutes the strings of a fixed length over a fixed radix
 * — here radix 2, so it permutes {0,1}^k, i.e. the integers [0, 2^k).
 *
 * The language slice this lab enciphers into has size N, which is essentially
 * never a power of two. **Cycle-walking** closes the gap: take k with
 * 2^k ≥ N > 2^(k-1), encipher with FF1, and if the result lands in
 * [N, 2^k) encipher again. Because FF1 is a permutation of [0, 2^k), the
 * restriction of "keep applying it until you land in [0, N)" is a permutation of
 * [0, N) — and it is invertible by walking the inverse the same way. The
 * expected number of applications is 2^k/N < 2.
 *
 * That is the piece this demo shares with its sibling `format-ward`: the same
 * FF1, over a different domain. There, the domain is the format itself (16
 * digits stay 16 digits). Here, the domain is |L ∩ Σ^n| — the number of strings
 * of length n a regular expression accepts — and the format is recovered by
 * unranking. Same cipher, one more layer of combinatorics.
 *
 * AES-128 is used, per the §5.2 prerequisite that the block cipher be AES with a
 * 128-, 192-, or 256-bit key; the FF1 key here is 128 bits of PBKDF2 output.
 */

const ZERO_IV = new Uint8Array(16);

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto SubtleCrypto is required and is not available in this context.");
  }
  return globalThis.crypto.subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase().replace(/\s+/g, "");
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Hex must contain only [0-9a-f] and have an even number of characters.");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const b of bytes) out = (out << 8n) + BigInt(b);
  return out;
}

export function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Minimal big-endian encoding — no leading zero byte. `0n` becomes one 0x00. */
export function bigIntToMinimalBytesBE(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError("Negative values have no big-endian byte form here.");
  if (value === 0n) return new Uint8Array([0]);
  const hex = value.toString(16);
  return hexToBytes(hex.length % 2 === 0 ? hex : `0${hex}`);
}

export async function importFf1Key(raw: Uint8Array): Promise<CryptoKey> {
  if (![16, 24, 32].includes(raw.length)) {
    throw new Error("The FF1 key must be 128, 192, or 256 bits.");
  }
  return subtle().importKey("raw", toArrayBuffer(raw), { name: "AES-CBC" }, false, ["encrypt"]);
}

async function aesEncryptBlock(key: CryptoKey, iv: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  // AES-CBC over one block with an explicit IV gives CIPH(IV ⊕ block); WebCrypto
  // appends a padding block, which is discarded.
  const out = await subtle().encrypt(
    { name: "AES-CBC", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(block)
  );
  return new Uint8Array(out).slice(0, 16);
}

async function cbcMac(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error("CBC-MAC input must be a whole number of blocks.");
  let y: Uint8Array<ArrayBufferLike> = ZERO_IV;
  for (let i = 0; i < data.length; i += 16) {
    y = await aesEncryptBlock(key, y, data.slice(i, i + 16));
  }
  return y;
}

function numRadix(symbols: Uint8Array, radix: number): bigint {
  const r = BigInt(radix);
  let out = 0n;
  for (const s of symbols) out = out * r + BigInt(s);
  return out;
}

function strRadix(value: bigint, m: number, radix: number): Uint8Array<ArrayBuffer> {
  const r = BigInt(radix);
  const out = new Uint8Array(m);
  let x = value;
  for (let i = m - 1; i >= 0; i -= 1) {
    out[i] = Number(x % r);
    x /= r;
  }
  return out;
}

function powBig(base: bigint, exp: number): bigint {
  let out = 1n;
  for (let i = 0; i < exp; i += 1) out *= base;
  return out;
}

function mod(a: bigint, n: bigint): bigint {
  return ((a % n) + n) % n;
}

/** The fixed 16-byte block P of SP 800-38G §5.2, step 5. */
function buildP(radix: number, n: number, u: number, tweakLength: number): Uint8Array {
  const p = new Uint8Array(16);
  p[0] = 0x01;
  p[1] = 0x02;
  p[2] = 0x01;
  p[3] = (radix >> 16) & 0xff;
  p[4] = (radix >> 8) & 0xff;
  p[5] = radix & 0xff;
  p[6] = 0x0a;
  p[7] = u & 0xff;
  p[8] = (n >>> 24) & 0xff;
  p[9] = (n >>> 16) & 0xff;
  p[10] = (n >>> 8) & 0xff;
  p[11] = n & 0xff;
  p[12] = (tweakLength >>> 24) & 0xff;
  p[13] = (tweakLength >>> 16) & 0xff;
  p[14] = (tweakLength >>> 8) & 0xff;
  p[15] = tweakLength & 0xff;
  return p;
}

/**
 * Minimum domain size, from Draft SP 800-38G Rev. 1 (2nd public draft, Feb 2025):
 * radix^minlen ≥ 1,000,000. The 2016 final text asked only for 100 and merely
 * *recommended* 10^6; Rev. 1 promoted it to a requirement after Hoang–Tessaro–Trieu
 * showed small domains fall to known-plaintext message recovery. With radix 2
 * that is a 20-bit domain, so this lab refuses to encipher into a language slice
 * smaller than 2^20 strings.
 */
export const MIN_DOMAIN_SIZE = 1_000_000n;

export interface Ff1Params {
  n: number;
  u: number;
  v: number;
  b: number;
  d: number;
  radix: number;
}

export function ff1Params(radix: number, n: number): Ff1Params {
  const u = Math.floor(n / 2);
  const v = n - u;
  const b = Math.ceil(Math.ceil(v * Math.log2(radix)) / 8);
  const d = 4 * Math.ceil(b / 4) + 4;
  return { n, u, v, b, d, radix };
}

async function roundY(
  key: CryptoKey,
  radix: number,
  tweak: Uint8Array,
  p: Uint8Array,
  i: number,
  b: number,
  d: number,
  right: Uint8Array
): Promise<bigint> {
  const rightBytes = bigIntToBytesBE(numRadix(right, radix), b);
  const padLen = (16 - ((tweak.length + 1 + b) % 16)) % 16;
  const q = new Uint8Array(tweak.length + padLen + 1 + b);
  q.set(tweak, 0);
  q[tweak.length + padLen] = i & 0xff;
  q.set(rightBytes, q.length - b);

  const pq = new Uint8Array(p.length + q.length);
  pq.set(p, 0);
  pq.set(q, p.length);

  const r = await cbcMac(key, pq);
  const blocks: Uint8Array[] = [r];
  for (let j = 1; j < Math.ceil(d / 16); j += 1) {
    const jBlock = bigIntToBytesBE(BigInt(j), 16);
    const x = new Uint8Array(16);
    for (let t = 0; t < 16; t += 1) x[t] = r[t] ^ jBlock[t];
    blocks.push(await aesEncryptBlock(key, ZERO_IV, x));
  }
  const s = new Uint8Array(blocks.length * 16);
  blocks.forEach((blk, idx) => s.set(blk, idx * 16));
  return bytesToBigIntBE(s.slice(0, d));
}

function validate(radix: number, symbols: Uint8Array): void {
  if (radix < 2 || radix > 65536) throw new Error("FF1 radix must be in [2, 65536].");
  if (symbols.length < 2) throw new Error("FF1 needs at least two symbols.");
  for (const s of symbols) {
    if (s >= radix) throw new Error("A symbol falls outside the radix.");
  }
}

export async function ff1Encrypt(
  key: CryptoKey,
  radix: number,
  plaintext: Uint8Array,
  tweak: Uint8Array = new Uint8Array()
): Promise<Uint8Array> {
  validate(radix, plaintext);
  const { n, u, v, b, d } = ff1Params(radix, plaintext.length);
  const p = buildP(radix, n, u, tweak.length);

  let a = plaintext.slice(0, u);
  let bHalf = plaintext.slice(u);
  for (let i = 0; i < 10; i += 1) {
    const m = i % 2 === 0 ? u : v;
    const y = await roundY(key, radix, tweak, p, i, b, d, bHalf);
    const c = mod(numRadix(a, radix) + y, powBig(BigInt(radix), m));
    a = bHalf;
    bHalf = strRadix(c, m, radix);
  }
  const out = new Uint8Array(n);
  out.set(a, 0);
  out.set(bHalf, a.length);
  return out;
}

export async function ff1Decrypt(
  key: CryptoKey,
  radix: number,
  ciphertext: Uint8Array,
  tweak: Uint8Array = new Uint8Array()
): Promise<Uint8Array> {
  validate(radix, ciphertext);
  const { n, u, v, b, d } = ff1Params(radix, ciphertext.length);
  const p = buildP(radix, n, u, tweak.length);

  let a = ciphertext.slice(0, u);
  let bHalf = ciphertext.slice(u);
  for (let i = 9; i >= 0; i -= 1) {
    const m = i % 2 === 0 ? u : v;
    const y = await roundY(key, radix, tweak, p, i, b, d, a);
    const c = mod(numRadix(bHalf, radix) - y, powBig(BigInt(radix), m));
    bHalf = a;
    a = strRadix(c, m, radix);
  }
  const out = new Uint8Array(n);
  out.set(a, 0);
  out.set(bHalf, a.length);
  return out;
}

/** Bit length of x, i.e. the smallest k with x < 2^k. */
export function bitsFor(x: bigint): number {
  return x <= 0n ? 0 : x.toString(2).length;
}

/** The k such that [0, 2^k) is the smallest binary domain containing [0, N). */
export function walkWidth(n: bigint): number {
  if (n < 2n) throw new RangeError("The domain must contain at least two values.");
  return bitsFor(n - 1n);
}

function toBits(value: bigint, k: number): Uint8Array {
  const out = new Uint8Array(k);
  for (let i = k - 1; i >= 0; i -= 1) {
    out[i] = Number(value & 1n);
    value >>= 1n;
  }
  return out;
}

function fromBits(bits: Uint8Array): bigint {
  let out = 0n;
  for (const b of bits) out = (out << 1n) | BigInt(b);
  return out;
}

/**
 * A walk longer than this is astronomically unlikely — each step lands outside
 * [0, N) with probability below 1/2, so 512 failures is a ~2^-512 event. Hitting
 * it means the domain or the permutation is wrong, and looping forever would
 * hide that.
 */
const MAX_WALK = 512;

export interface CycleWalkResult {
  value: bigint;
  /** How many FF1 applications the walk took. 1 means it landed first try. */
  steps: number;
  /**
   * Every value the walk produced, in order, the last of which is `value`.
   * Kept so the page can draw the walk rather than assert a step count: a
   * reader who is told "4 applications" learns a number, and a reader who
   * watches three landings miss [0, N) and the fourth land inside learns why
   * cycle-walking is the thing that makes FF1 usable on a language slice.
   *
   * Bounded by MAX_WALK, so this cannot grow without limit.
   */
  landings: bigint[];
}

export async function cycleWalkEncrypt(
  key: CryptoKey,
  domain: bigint,
  value: bigint,
  tweak: Uint8Array
): Promise<CycleWalkResult> {
  assertDomain(domain, value);
  const k = walkWidth(domain);
  let current = value;
  const landings: bigint[] = [];
  for (let steps = 1; steps <= MAX_WALK; steps += 1) {
    current = fromBits(await ff1Encrypt(key, 2, toBits(current, k), tweak));
    landings.push(current);
    if (current < domain) return { value: current, steps, landings };
  }
  throw new Error(`Cycle walk did not terminate in ${MAX_WALK} steps.`);
}

export async function cycleWalkDecrypt(
  key: CryptoKey,
  domain: bigint,
  value: bigint,
  tweak: Uint8Array
): Promise<CycleWalkResult> {
  assertDomain(domain, value);
  const k = walkWidth(domain);
  let current = value;
  const landings: bigint[] = [];
  for (let steps = 1; steps <= MAX_WALK; steps += 1) {
    current = fromBits(await ff1Decrypt(key, 2, toBits(current, k), tweak));
    landings.push(current);
    if (current < domain) return { value: current, steps, landings };
  }
  throw new Error(`Cycle walk did not terminate in ${MAX_WALK} steps.`);
}

function assertDomain(domain: bigint, value: bigint): void {
  if (domain < MIN_DOMAIN_SIZE) {
    throw new Error(
      `Domain of ${domain} is below the Draft SP 800-38G Rev. 1 minimum of 1,000,000. ` +
        `Small domains fall to codebook recovery, so this lab will not encipher into one — ` +
        `raise n until the language slice holds at least 2^20 strings.`
    );
  }
  if (value < 0n || value >= domain) {
    throw new RangeError(`Value ${value} is outside the domain [0, ${domain}).`);
  }
  if (walkWidth(domain) < 2) throw new RangeError("FF1 needs a domain of at least 2 bits.");
}
