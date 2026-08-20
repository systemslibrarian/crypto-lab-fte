/**
 * The two drawings that turn numbers on this page into shapes.
 *
 * Both are `role="img"` with a written summary and a text alternative beside
 * them — the cycle walk has a readout sentence, the capacity curve has the
 * count table. Neither carries information that exists nowhere else, because a
 * chart that is the only route to a fact is a chart that excludes readers.
 *
 * Colour is never the only signal. On the walk, rejected landings sit visibly
 * OUTSIDE the inner bar and the accepted one sits inside — position carries the
 * verdict, and the stroke is a second cue rather than the first.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function clear(svg: SVGSVGElement): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/** BigInt → a float fraction of `whole`, without overflowing Number. */
function fraction(value: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  // Scale through a fixed denominator so huge domains (2^384) stay exact enough
  // to position a dot, which Number(value) / Number(whole) would not be.
  const SCALE = 1_000_000n;
  return Number((value * SCALE) / whole) / Number(SCALE);
}

// ── Cycle walk ──────────────────────────────────────────────────────────────

export interface WalkInput {
  /** N — the language slice. */
  domain: bigint;
  /** k, so the outer bar is [0, 2^k). */
  walkBits: number;
  landings: bigint[];
}

const WALK_W = 660;
const WALK_H = 150;
const WALK_PAD = 18;

export function renderWalk(svg: SVGSVGElement, input: WalkInput | null): void {
  clear(svg);
  if (!input || input.landings.length === 0) {
    svg.setAttribute("viewBox", `0 0 ${WALK_W} 40`);
    svg.setAttribute("width", String(WALK_W));
    svg.setAttribute("height", "40");
    return;
  }

  const ceiling = 1n << BigInt(input.walkBits);
  const inner = WALK_W - WALK_PAD * 2;
  const barY = 62;
  const barH = 22;

  svg.setAttribute("viewBox", `0 0 ${WALK_W} ${WALK_H}`);
  svg.setAttribute("width", String(WALK_W));
  svg.setAttribute("height", String(WALK_H));

  // Outer bar: everything FF1 can produce. Outlined rather than filled, so no
  // mark ever has to meet a bright fill for its 3:1.
  svg.appendChild(
    el("rect", { x: WALK_PAD, y: barY, width: inner, height: barH, rx: 4, class: "walk-outer" })
  );
  // Inner bar: the slice we need to land in.
  const domainW = Math.max(2, inner * fraction(input.domain, ceiling));
  svg.appendChild(
    el("rect", { x: WALK_PAD, y: barY, width: domainW, height: barH, rx: 4, class: "walk-inner" })
  );

  const outerLabel = el("text", { x: WALK_PAD, y: barY + barH + 38, class: "walk-label" });
  outerLabel.textContent = `0 … 2^${input.walkBits}`;
  svg.appendChild(outerLabel);

  const innerLabel = el("text", {
    x: WALK_PAD + domainW,
    y: barY - 8,
    class: "walk-label",
    "text-anchor": domainW > inner * 0.8 ? "end" : "start"
  });
  innerLabel.textContent = "N";
  svg.appendChild(innerLabel);

  input.landings.forEach((landing, i) => {
    const x = WALK_PAD + inner * fraction(landing, ceiling);
    const accepted = landing < input.domain;
    // Position, not colour, carries the verdict: a rejected landing sits above
    // the bar and an accepted one sits on it. The stroke is the second cue.
    const y = accepted ? barY + barH / 2 : barY - 26;
    svg.appendChild(
      el("line", {
        x1: x,
        y1: accepted ? barY - 4 : barY - 20,
        x2: x,
        y2: accepted ? barY + barH + 4 : barY,
        class: accepted ? "walk-tick is-in" : "walk-tick is-out"
      })
    );
    svg.appendChild(
      el("circle", { cx: x, cy: y, r: accepted ? 7 : 5, class: accepted ? "walk-dot is-in" : "walk-dot is-out" })
    );
    // Never on the mark — a numeral over a filled dot is text on a background
    // this file does not control, and it would owe 4.5:1 against it.
    const label = el("text", {
      x,
      y: accepted ? barY + barH + 20 : barY - 38,
      class: "walk-dot-label",
      "text-anchor": "middle"
    });
    label.textContent = String(i + 1);
    svg.appendChild(label);
  });
}

/**
 * The sentence that says what the drawing says.
 *
 * `domainLabel` is passed in rather than derived from `input.domain`, because
 * N for the base64 preset is 64^64 — a 116-digit run with no break opportunity
 * in it, which pushed the whole document sideways at 380px. The caller already
 * owns the abbreviation the rest of the page uses; reusing it keeps this
 * sentence agreeing with the stat grid instead of inventing a second format.
 */
export function walkReadout(input: WalkInput, domainLabel: string): string {
  const rejected = input.landings.length - 1;
  const head =
    rejected === 0
      ? `One FF1 application, and it landed inside [0, N) first try.`
      : `${input.landings.length} FF1 applications: ${rejected} landed outside [0, N) and were re-enciphered, the last landed inside.`;
  const missRate = (1 - fraction(input.domain, 1n << BigInt(input.walkBits))) * 100;
  return `${head} FF1 permutes [0, 2^${input.walkBits}); the slice is N = ${domainLabel}, so a uniform result misses it about ${missRate.toFixed(1)}% of the time.`;
}

// ── Capacity curve ──────────────────────────────────────────────────────────

export interface CurveInput {
  /** capacityBits indexed by n, as `scanCapacity` produced them. */
  capacityByN: number[];
  /** The n currently chosen. */
  chosenN: number;
  /** Bits the current message needs, or null when there is no message. */
  requiredBits: number | null;
  /** The smallest n that fits `requiredBits`, or null when nothing does. */
  fitN: number | null;
}

const CURVE_W = 660;
const CURVE_H = 240;
const CURVE_L = 52;
const CURVE_R = 16;
const CURVE_T = 16;
const CURVE_B = 40;

export function renderCurve(svg: SVGSVGElement, input: CurveInput | null): void {
  clear(svg);
  if (!input || input.capacityByN.length < 2) {
    svg.setAttribute("viewBox", `0 0 ${CURVE_W} 40`);
    svg.setAttribute("width", String(CURVE_W));
    svg.setAttribute("height", "40");
    return;
  }

  const maxN = input.capacityByN.length - 1;
  const maxBits = Math.max(1, ...input.capacityByN, input.requiredBits ?? 0);
  const plotW = CURVE_W - CURVE_L - CURVE_R;
  const plotH = CURVE_H - CURVE_T - CURVE_B;
  const x = (n: number): number => CURVE_L + (plotW * n) / Math.max(1, maxN);
  const y = (bits: number): number => CURVE_T + plotH - (plotH * bits) / maxBits;

  svg.setAttribute("viewBox", `0 0 ${CURVE_W} ${CURVE_H}`);
  svg.setAttribute("width", String(CURVE_W));
  svg.setAttribute("height", String(CURVE_H));

  // Axes.
  svg.appendChild(el("line", { x1: CURVE_L, y1: CURVE_T, x2: CURVE_L, y2: CURVE_T + plotH, class: "curve-axis" }));
  svg.appendChild(
    el("line", { x1: CURVE_L, y1: CURVE_T + plotH, x2: CURVE_L + plotW, y2: CURVE_T + plotH, class: "curve-axis" })
  );

  for (const [bits, label] of [
    [maxBits, String(maxBits)],
    [0, "0"]
  ] as Array<[number, string]>) {
    const tick = el("text", { x: CURVE_L - 8, y: y(bits) + 4, class: "curve-tick", "text-anchor": "end" });
    tick.textContent = label;
    svg.appendChild(tick);
  }
  for (const n of [0, maxN]) {
    const tick = el("text", { x: x(n), y: CURVE_T + plotH + 18, class: "curve-tick", "text-anchor": "middle" });
    tick.textContent = `n = ${n}`;
    svg.appendChild(tick);
  }
  const axisY = el("text", { x: CURVE_L - 8, y: CURVE_T - 4, class: "curve-tick", "text-anchor": "end" });
  axisY.textContent = "bits";
  svg.appendChild(axisY);

  // The curve.
  const d = input.capacityByN
    .map((bits, n) => `${n === 0 ? "M" : "L"} ${x(n).toFixed(1)} ${y(bits).toFixed(1)}`)
    .join(" ");
  svg.appendChild(el("path", { d, class: "curve-line" }));

  // The requirement line, and where it crosses.
  if (input.requiredBits !== null && input.requiredBits <= maxBits) {
    svg.appendChild(
      el("line", {
        x1: CURVE_L,
        y1: y(input.requiredBits),
        x2: CURVE_L + plotW,
        y2: y(input.requiredBits),
        class: "curve-need"
      })
    );
    const label = el("text", { x: CURVE_L + 6, y: y(input.requiredBits) - 6, class: "curve-tick" });
    label.textContent = `needs ${input.requiredBits}`;
    svg.appendChild(label);
  }

  if (input.fitN !== null) {
    svg.appendChild(
      el("circle", { cx: x(input.fitN), cy: y(input.capacityByN[input.fitN] ?? 0), r: 5, class: "curve-fit" })
    );
  }

  // The chosen n.
  if (input.chosenN >= 0 && input.chosenN <= maxN) {
    svg.appendChild(
      el("line", { x1: x(input.chosenN), y1: CURVE_T, x2: x(input.chosenN), y2: CURVE_T + plotH, class: "curve-chosen" })
    );
    svg.appendChild(
      el("circle", { cx: x(input.chosenN), cy: y(input.capacityByN[input.chosenN] ?? 0), r: 6, class: "curve-dot" })
    );
    const label = el("text", {
      x: x(input.chosenN),
      y: CURVE_T + plotH + 32,
      class: "curve-tick",
      "text-anchor": "middle"
    });
    label.textContent = `chosen n = ${input.chosenN}`;
    svg.appendChild(label);
  }
}
