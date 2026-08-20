/**
 * "Length leakage", made observable.
 *
 * The second honest limitation says n is public, so the stego string's length
 * is a direct function of the message's length class — and that the encoder
 * GROWING n turns a longer message into a visibly longer string. Both are true
 * and neither was visible: the capacity curve explains why n grows, but never
 * shows it as something an observer on the wire exploits.
 *
 * This builds the ladder an observer would actually construct. For each message
 * size it computes the payload bits required, the smallest n that holds them,
 * and therefore the length of the string that appears on the wire. Rows sharing
 * a wire length are indistinguishable to that observer; rows that differ are
 * not, and the observer learns a bound on the message from the length alone.
 *
 * Pure arithmetic over the count table already on screen — no cipher, no keys,
 * nothing random. The leak does not depend on any of those, which is the point.
 */

import { payloadBitsFor } from "./fte.ts";
import { capacityBitsOf } from "./rank.ts";

export interface Rung {
  messageBytes: number;
  /** 8 * (bytes + 1) — the frame byte is payload too. */
  payloadBits: number;
  /** The n the encoder would choose, or null when nothing holds it. */
  n: number | null;
  /** Capacity at that n, for the "how much slack is left" reading. */
  capacityBits: number | null;
  /** How many other rungs share this wire length. */
  bucketSize: number;
}

export interface Ladder {
  rungs: Rung[];
  /** Distinct wire lengths — how many buckets an observer can separate. */
  buckets: number;
  /** The largest message size that still fits anywhere under the ceiling. */
  maxBytes: number | null;
}

/**
 * `counts[k]` is C[q0][k], exactly as `CompiledFormat.counts` holds it.
 * `upToBytes` bounds the ladder; the caller keeps it small enough to read.
 */
export function buildLadder(counts: bigint[], upToBytes: number): Ladder {
  const rungs: Rung[] = [];
  let maxBytes: number | null = null;

  for (let bytes = 1; bytes <= upToBytes; bytes += 1) {
    const payloadBits = payloadBitsFor(bytes);
    let chosen: number | null = null;
    for (let n = 0; n < counts.length; n += 1) {
      if (counts[n] > 0n && capacityBitsOf(counts[n]) >= payloadBits) {
        chosen = n;
        break;
      }
    }
    if (chosen !== null) maxBytes = bytes;
    rungs.push({
      messageBytes: bytes,
      payloadBits,
      n: chosen,
      capacityBits: chosen === null ? null : capacityBitsOf(counts[chosen]),
      bucketSize: 0
    });
  }

  // A bucket is a wire length. Rows inside one are indistinguishable by length.
  const sizes = new Map<number, number>();
  for (const rung of rungs) {
    if (rung.n === null) continue;
    sizes.set(rung.n, (sizes.get(rung.n) ?? 0) + 1);
  }
  for (const rung of rungs) {
    rung.bucketSize = rung.n === null ? 0 : (sizes.get(rung.n) ?? 0);
  }

  return { rungs, buckets: sizes.size, maxBytes };
}

/**
 * What the observer learns from one wire length: the range of message sizes it
 * is consistent with. This is the leak stated as the adversary would state it.
 */
export function bytesConsistentWith(ladder: Ladder, wireLength: number): number[] {
  return ladder.rungs.filter((r) => r.n === wireLength).map((r) => r.messageBytes);
}

export function ladderReadout(ladder: Ladder): string {
  if (ladder.maxBytes === null) {
    return "This format holds nothing at any length under the ceiling, so there is no ladder to climb.";
  }
  if (ladder.buckets === 1) {
    return (
      `Every message from 1 to ${ladder.maxBytes} bytes comes out at the same length, so the wire ` +
      `leaks nothing about the message size — this format has exactly one bucket. That is the ` +
      `good case, and it is an accident of the format, not a property of FTE.`
    );
  }
  return (
    `${ladder.buckets} distinct wire lengths across ${ladder.maxBytes} message sizes. Two messages ` +
    `in the same row-group are indistinguishable by length; two in different ones are not, and an ` +
    `observer who only counts characters already knows which group you are in.`
  );
}
