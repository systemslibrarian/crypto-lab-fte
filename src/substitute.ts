/**
 * "No authentication", made pressable.
 *
 * The third honest limitation says an adversary who sees a stego string can
 * replace it with ANY other member of the language, and the receiver has no way
 * to tell substitution from a genuine message. That is the most alarming claim
 * on the page and, until now, the only one with nothing behind it.
 *
 * So the demo performs the attack. It takes the reader's own encode, swaps the
 * string for other real members of the same slice, and runs the receiver's own
 * decode over each. Three things can come back:
 *
 *   rejected-frame  the recovered bytes do not begin 0x01
 *   rejected-utf8   they do, but they are not valid UTF-8
 *   accepted        both checks pass, and the receiver is handed a message
 *                   that Alice never sent
 *
 * The last outcome is the one that matters, and its RATE is the lesson. The
 * page prints the measured rate beside `frameByteFalseAccept`'s closed-form
 * prediction — two independent routes to the same number, one counting
 * intervals and one actually running the cipher. On the phone preset that is
 * ~43% past the frame byte, of which the UTF-8 check kills most, leaving
 * roughly one substitution in thirty returning plausible-looking garbage.
 *
 * Nothing here is simulated: every candidate is a real unranking, and every
 * trial is a real inverse cycle walk through FF1.
 */

import { CompiledFormat, PreparedDecode, decodeWith } from "./fte.ts";
import { CountTable, unrank } from "./rank.ts";

export type Outcome = "rejected-frame" | "rejected-utf8" | "accepted";

export interface Trial {
  /** The string the adversary put on the wire instead. */
  stego: string;
  outcome: Outcome;
  /** What the receiver was handed, when it was handed anything. */
  message: string | null;
  /** The receiver's own words for the refusal, when it refused. */
  reason: string | null;
}

export interface SubstitutionReport {
  trials: Trial[];
  accepted: number;
  rejectedFrame: number;
  rejectedUtf8: number;
  /** accepted / trials, the measured end-to-end false-accept rate. */
  measuredRate: number;
}

/** Classify one refusal by which of the receiver's two checks caught it. */
export function classifyFailure(message: string): Outcome {
  return message.includes("no frame marker") ? "rejected-frame" : "rejected-utf8";
}

/**
 * Run `count` substitutions. `pickIndex` supplies the adversary's choices so
 * tests can be deterministic; in the page it is a CSPRNG draw over [0, N).
 */
export async function runSubstitutions(
  format: CompiledFormat,
  table: CountTable,
  prepared: PreparedDecode,
  original: string,
  count: number,
  pickIndex: (bound: bigint) => bigint
): Promise<SubstitutionReport> {
  const trials: Trial[] = [];

  for (let i = 0; i < count; i += 1) {
    const candidate = unrank(format.dfa, table, pickIndex(table.total));
    // Substituting the original string is not an attack, it is a no-op — and
    // it would decode correctly and skew the rate. Skip it and try again.
    if (candidate === original) {
      if (count < Number(table.total)) i -= 1;
      continue;
    }

    try {
      const result = await decodeWith(format, candidate, prepared);
      trials.push({ stego: candidate, outcome: "accepted", message: result.message, reason: null });
    } catch (error) {
      const reason = (error as Error).message;
      trials.push({ stego: candidate, outcome: classifyFailure(reason), message: null, reason });
    }
  }

  const accepted = trials.filter((t) => t.outcome === "accepted").length;
  return {
    trials,
    accepted,
    rejectedFrame: trials.filter((t) => t.outcome === "rejected-frame").length,
    rejectedUtf8: trials.filter((t) => t.outcome === "rejected-utf8").length,
    measuredRate: trials.length === 0 ? 0 : accepted / trials.length
  };
}
