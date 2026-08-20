/**
 * Replay protection.
 *
 * The counter is authenticated — a receiver that guessed wrong derived
 * different keys and its tag cannot match — but authentication alone says
 * nothing about FRESHNESS. A recorded stego string stays valid forever: replay
 * it and the tag verifies, because it is the same tag it always was. On a
 * covert channel that is a real attack, not a footnote. "Send the money" is
 * just as authentic the second time.
 *
 * The fix is the standard one, from IPsec (RFC 6479) and DTLS: a sliding
 * window of counters already accepted. Anything at or below the floor is too
 * old to judge and is refused; anything inside the window is checked against a
 * bitmap; anything above advances the window.
 *
 * The window has to exist because the counter is implicit and the channel is
 * lossy — messages can be missed, so a receiver cannot simply demand
 * `counter == expected + 1`. It also cannot accept arbitrary gaps forever, or
 * the bitmap would have to be unbounded. `WINDOW_BITS` is the compromise, and
 * it is the same number the resync search uses.
 *
 * The bitmap is a BigInt used as a bit set. This is receiver-side bookkeeping
 * on a value the attacker chose and can already see, so there is no secret here
 * to leak through BigInt's variable-time arithmetic — unlike `rankct.ts`, where
 * there is.
 */

export const WINDOW_BITS = 64;

export interface ReplayWindow {
  /** Highest counter accepted so far, or -1 before anything has been. */
  highest: number;
  /** Bit i set means `highest - i` has been accepted. */
  bitmap: bigint;
  /** How many counters back the window reaches. */
  size: number;
}

export function createWindow(size: number = WINDOW_BITS): ReplayWindow {
  if (size < 1 || size > 1024) throw new RangeError("Window size must be between 1 and 1024.");
  return { highest: -1, bitmap: 0n, size };
}

export type Rejection = "replayed" | "too-old";

/**
 * Would this counter be accepted? Pure — it never mutates the window, so a
 * caller can ask before committing to the rest of an expensive verification.
 */
export function wouldAccept(win: ReplayWindow, counter: number): true | Rejection {
  if (!Number.isSafeInteger(counter) || counter < 0) return "too-old";
  if (win.highest < 0) return true;
  if (counter > win.highest) return true;

  const age = win.highest - counter;
  if (age >= win.size) return "too-old";
  return (win.bitmap >> BigInt(age)) & 1n ? "replayed" : true;
}

/**
 * Record a counter as used, returning the new window. Never mutates its input,
 * so a caller that later rejects the message for another reason can simply
 * discard the result rather than having to undo it.
 */
export function accept(win: ReplayWindow, counter: number): ReplayWindow {
  const verdict = wouldAccept(win, counter);
  if (verdict !== true) {
    throw new Error(`Counter ${counter} is ${verdict === "replayed" ? "a replay" : "too old"}.`);
  }

  if (win.highest < 0) {
    return { highest: counter, bitmap: 1n, size: win.size };
  }
  if (counter > win.highest) {
    const shift = counter - win.highest;
    // Shifting past the window empties it, which is correct: everything it held
    // is now older than the floor and would be refused as too-old anyway.
    const shifted = shift >= win.size ? 0n : win.bitmap << BigInt(shift);
    const mask = (1n << BigInt(win.size)) - 1n;
    return { highest: counter, bitmap: (shifted | 1n) & mask, size: win.size };
  }

  const age = win.highest - counter;
  return { highest: win.highest, bitmap: win.bitmap | (1n << BigInt(age)), size: win.size };
}

/** Human-readable state, for the panel that shows the window working. */
export function describe(win: ReplayWindow): string {
  if (win.highest < 0) return "Nothing accepted yet — any counter is fresh.";
  const floor = Math.max(0, win.highest - win.size + 1);
  let seen = 0;
  for (let i = 0; i < win.size; i += 1) if ((win.bitmap >> BigInt(i)) & 1n) seen += 1;
  return `Highest accepted: ${win.highest}. Window covers ${floor}–${win.highest}; ${seen} counter${seen === 1 ? "" : "s"} in it already used. Anything below ${floor} is refused as too old.`;
}
