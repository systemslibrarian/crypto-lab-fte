import { describe, expect, it } from "vitest";
import { WINDOW_BITS, accept, createWindow, describe as describeWindow, wouldAccept } from "./replay.ts";

describe("the replay window", () => {
  it("accepts a fresh counter and then refuses the same one", () => {
    let win = createWindow();
    expect(wouldAccept(win, 5)).toBe(true);
    win = accept(win, 5);
    expect(wouldAccept(win, 5)).toBe("replayed");
    expect(() => accept(win, 5)).toThrow(/replay/);
  });

  it("accepts out-of-order arrivals inside the window", () => {
    let win = createWindow();
    win = accept(win, 10);
    for (const late of [7, 9, 4, 8]) {
      expect(wouldAccept(win, late)).toBe(true);
      win = accept(win, late);
    }
    // ...but not twice.
    for (const late of [7, 9, 4, 8, 10]) expect(wouldAccept(win, late)).toBe("replayed");
  });

  it("refuses anything that has fallen off the back of the window", () => {
    let win = createWindow(8);
    win = accept(win, 100);
    expect(wouldAccept(win, 93)).toBe(true);
    expect(wouldAccept(win, 92)).toBe("too-old");
    expect(wouldAccept(win, 0)).toBe("too-old");
  });

  it("a jump past the window empties it rather than keeping stale bits", () => {
    let win = createWindow(8);
    win = accept(win, 1);
    win = accept(win, 2);
    win = accept(win, 500);
    // 1 and 2 are now far below the floor; they are refused as too old, and
    // crucially NOT as "fresh" through a bitmap that wrapped.
    expect(wouldAccept(win, 1)).toBe("too-old");
    expect(wouldAccept(win, 2)).toBe("too-old");
    expect(wouldAccept(win, 500)).toBe("replayed");
    expect(wouldAccept(win, 499)).toBe(true);
  });

  it("never mutates the window it is given", () => {
    const win = createWindow();
    const snapshot = { ...win };
    accept(win, 42);
    expect(win).toEqual(snapshot);
    wouldAccept(win, 42);
    expect(win).toEqual(snapshot);
  });

  it("holds the full window width without losing an entry", () => {
    let win = createWindow(WINDOW_BITS);
    win = accept(win, WINDOW_BITS - 1);
    for (let c = 0; c < WINDOW_BITS - 1; c += 1) win = accept(win, c);
    for (let c = 0; c < WINDOW_BITS; c += 1) expect(wouldAccept(win, c)).toBe("replayed");
    expect(wouldAccept(win, WINDOW_BITS)).toBe(true);
  });

  it("rejects nonsense counters instead of throwing on them", () => {
    const win = accept(createWindow(), 5);
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(wouldAccept(win, bad)).toBe("too-old");
    }
  });

  it("describes its own state in words", () => {
    expect(describeWindow(createWindow())).toContain("Nothing accepted yet");
    const win = accept(accept(createWindow(8), 20), 18);
    const text = describeWindow(win);
    expect(text).toContain("Highest accepted: 20");
    expect(text).toContain("2 counters");
  });
});
