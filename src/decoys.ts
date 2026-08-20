/**
 * "Uniform is not the same as realistic", made playable.
 *
 * The first honest limitation on the page is the most important sentence on it,
 * and prose is a bad way to deliver it: a reader who has just watched the
 * classifier wave the stego string through is in exactly the wrong frame of
 * mind to absorb "and yet a human would spot this instantly". So they get to
 * try, fail, and be told why.
 *
 * The generated candidates come from the real `unrank` path over the real count
 * table — not a mock, not a template with random digits. If the game were fed
 * plausible-looking fakes it would be teaching a lie about the very thing the
 * page exists to be honest about.
 *
 * Realism is only defined where a corpus notion exists. North American phone
 * numbers have published structure (NANP), and zero-padded dotted quads have
 * strong conventions. A "realistic" random hex string is not a thing — which is
 * itself the lesson for those presets, so the game declines to run and says so
 * rather than inventing a distribution nobody could defend.
 */

export interface Candidate {
  value: string;
  /** True when this came out of the FTE unranking. */
  generated: boolean;
  /** Why it is or is not realistic — shown only after the reveal. */
  tell: string;
}

export type Rng = (bound: number) => number;

/** Uniform in [0, bound) from the platform CSPRNG. */
export function cryptoRng(bound: number): number {
  if (bound <= 0) return 0;
  const limit = Math.floor(0xffffffff / bound) * bound;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % bound;
}

/**
 * NANP structure, as the industry actually assigns it:
 *   - area code:   first digit 2-9, and not an N11 service code (911, 411, …)
 *   - exchange:    first digit 2-9, and not 555 (fiction reserves 555-0100..0199)
 *   - subscriber:  unconstrained
 * A uniform draw over 10^10 satisfies none of this about 22% of the time on the
 * area code alone, which is why the game is winnable at all.
 */
function realisticPhone(rng: Rng): string {
  let area: number;
  do {
    area = 200 + rng(800);
  } while (area % 100 === 11);
  let exchange: number;
  do {
    exchange = 200 + rng(800);
  } while (exchange === 555);
  const line = rng(10000);
  return `(${area}) ${String(exchange).padStart(3, "0")}-${String(line).padStart(4, "0")}`;
}

/**
 * Dotted quads people actually see in a log: RFC 1918 space, loopback, and a
 * scatter of routable addresses — never 000.x, never a .255 broadcast, and
 * never the uniform-over-256-per-octet soup the language slice produces.
 */
function realisticIpv4(rng: Rng): string {
  const shapes: Array<() => number[]> = [
    () => [192, 168, rng(4), 1 + rng(60)],
    () => [10, rng(4), rng(8), 1 + rng(60)],
    () => [172, 16 + rng(16), rng(8), 1 + rng(60)],
    () => [127, 0, 0, 1],
    () => [8, 8, 8, 8],
    () => [1 + rng(126), rng(256), rng(256), 1 + rng(254)]
  ];
  const octets = shapes[rng(shapes.length)]();
  return octets.map((o) => String(o).padStart(3, "0")).join(".");
}

/**
 * Whether a realistic corpus exists for this preset, and the honest reason when
 * it does not. Returned rather than thrown: "there is no realistic hex string"
 * is a teaching outcome, not an error condition.
 */
export function realismFor(presetId: string): { make: (rng: Rng) => string } | { why: string } {
  if (presetId === "phone") return { make: realisticPhone };
  if (presetId === "ipv4") return { make: realisticIpv4 };
  if (presetId === "hex" || presetId === "base64") {
    return {
      why:
        "There is no such thing as a realistic random hex or base64 blob — the genuine article is " +
        "uniform too. That is exactly why these two formats are the easy case for FTE, and why the " +
        "phone number is the hard one: the more structure a human expects, the more a uniform draw " +
        "gives itself away."
    };
  }
  return {
    why:
      "This game only runs on the presets with a documented real-world distribution — the phone " +
      "number and the dotted quad. Inventing a corpus for a custom pattern would be making up the " +
      "very thing this limitation is about."
  };
}

/** The tells a reader could have used, computed against the actual value. */
export function phoneTells(value: string): string[] {
  const tells: string[] = [];
  const m = /^\((\d{3})\) (\d{3})-(\d{4})$/.exec(value);
  if (!m) return tells;
  const [, area, exchange] = m;
  if (area[0] === "0" || area[0] === "1") tells.push(`area code ${area} starts with ${area[0]} — never assigned`);
  if (area[1] === area[2] && area[1] === "1") tells.push(`${area} is an N11 service code`);
  if (exchange[0] === "0" || exchange[0] === "1") tells.push(`exchange ${exchange} starts with ${exchange[0]} — never assigned`);
  if (exchange === "555") tells.push("555 is reserved for fiction");
  return tells;
}

export function ipv4Tells(value: string): string[] {
  const tells: string[] = [];
  const octets = value.split(".").map((o) => Number(o));
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return tells;
  if (octets[0] === 0) tells.push("first octet 000 — not a routable source");
  if (octets[0] > 223) tells.push(`first octet ${octets[0]} is multicast or reserved space`);
  if (octets[3] === 0 || octets[3] === 255) tells.push(`host octet ${String(octets[3]).padStart(3, "0")} is a network or broadcast address`);
  return tells;
}

export function tellsFor(presetId: string, value: string): string[] {
  if (presetId === "phone") return phoneTells(value);
  if (presetId === "ipv4") return ipv4Tells(value);
  return [];
}

export interface Round {
  candidates: Candidate[];
  /** How many of them came out of the encoder. */
  generatedCount: number;
}

/**
 * Build one round: `generated` real unrankings interleaved with `realistic`
 * corpus draws, shuffled. The caller supplies the generated strings because
 * only it holds the count table; this module never fakes one.
 */
export function buildRound(
  presetId: string,
  generated: string[],
  realisticCount: number,
  rng: Rng = cryptoRng
): Round {
  const realism = realismFor(presetId);
  if (!("make" in realism)) {
    return { candidates: [], generatedCount: 0 };
  }

  const candidates: Candidate[] = generated.map((value) => {
    const tells = tellsFor(presetId, value);
    return {
      value,
      generated: true,
      tell:
        tells.length > 0
          ? `Generated. Tells: ${tells.join("; ")}.`
          : "Generated — and this one happens to carry no obvious tell. Uniform draws land inside the plausible region often enough that the game is not a reliable detector either."
    };
  });

  const seen = new Set(generated);
  let guard = 0;
  while (candidates.filter((c) => !c.generated).length < realisticCount && guard < 500) {
    guard += 1;
    const value = realism.make(rng);
    if (seen.has(value)) continue;
    seen.add(value);
    candidates.push({
      value,
      generated: false,
      tell: "Real-world shape: assigned prefix, conventional structure."
    });
  }

  // Fisher-Yates, so position carries no information.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return { candidates, generatedCount: candidates.filter((c) => c.generated).length };
}

export interface Score {
  correct: number;
  total: number;
  /** Generated strings the player marked as real — the ones that fooled them. */
  missed: Candidate[];
}

export function scoreRound(round: Round, picked: Set<string>): Score {
  let correct = 0;
  const missed: Candidate[] = [];
  for (const candidate of round.candidates) {
    const chose = picked.has(candidate.value);
    if (chose === candidate.generated) correct += 1;
    else if (candidate.generated) missed.push(candidate);
  }
  return { correct, total: round.candidates.length, missed };
}
