/**
 * Wiring. Every number this file prints is read back out of the real objects —
 * the DFA, the count table, the encode result — never recomputed from a
 * hand-written formula, so the page cannot drift from the mathematics behind it.
 */

import {
  CompiledFormat,
  EncodeResult,
  chooseLength,
  compileFormat,
  decode,
  encode,
  frameByteFalseAccept,
  payloadBitsFor,
  prepareDecode
} from "../fte.ts";
import {
  MAX_N,
  MAX_TABLE_BYTES,
  buildCountTable,
  capacityBitsOf,
  estimateTableBytes,
  scanCapacity,
  smallestLengthFor,
  unrank
} from "../rank.ts";
import { hexToBytes } from "../ff1.ts";
import { PBKDF2_ITERATIONS } from "../keys.ts";
import { clearDfa, clearHighlight, highlightPath, renderDfa, transitionRows } from "../dfaview.ts";
import { Path, pathEdges, tracePath } from "../pathtrace.ts";
import {
  ClassifierError,
  classify,
  compileClassifier,
  payloadsFor,
  readClassifier
} from "../classifier.ts";
import { Round, buildRound, realismFor, scoreRound } from "../decoys.ts";
import { Ladder, buildLadder, bytesConsistentWith, ladderReadout } from "../lengths.ts";
import { runSubstitutions } from "../substitute.ts";
import {
  AuthError,
  CapacityError,
  SealResult,
  TAG_CHOICES,
  TagBytes,
  budget,
  open as authOpen,
  seal as authSeal
} from "../aead.ts";
import { deriveRoot } from "../schedule.ts";
import { Identity, agree, bestSuite, generateIdentity } from "../handshake.ts";
import { SealedFragments, openFragments, plan, sealFragments } from "../frag.ts";
import { ReplayWindow, accept, createWindow, describe as describeWindow } from "../replay.ts";
import { FF1_VECTORS, VectorRun, runVector, tally } from "../vectors.ts";
import { assertNoSecrets, decodeState, encodeState } from "../share.ts";
import { CurveInput, WalkInput, renderCurve, renderWalk, walkReadout } from "./charts.ts";
import { TOUR } from "./tour.ts";
import { PRESETS, template } from "./template.ts";

const COUNT_ROWS = 20;
const GRAPH_STATE_CAP = 64;

interface State {
  format: CompiledFormat | null;
  n: number;
  lastEncode: EncodeResult | null;
  /** `pattern|n` the last encode was produced under. See `retireStaleResults`. */
  lastEncodeSignature: string | null;
  /** The route the last stego string walks, for the scrubber and the drawing. */
  lastPath: Path | null;
  /** The Spot-the-fake round in play, or null before the first deal. */
  round: Round | null;
  /** Whether the reveal has happened, so a second click cannot re-score. */
  revealed: boolean;
  /** 0-based guided-path step, or null when the path is not running. */
  tourStep: number | null;
  /** True once the reader edits the classifier away from the format regex. */
  classifierPinned: boolean;
  /** PBKDF2 output, cached so it runs once per passphrase rather than per message. */
  authRoot: Uint8Array | null;
  /** The passphrase `authRoot` belongs to, so a change invalidates it. */
  authRootFor: string | null;
  lastSeal: SealResult | null;
  /** Root from the key exchange, when one has been run. */
  handshakeRoot: Uint8Array | null;
  lastFragments: SealedFragments | null;
  /** The receiver's freshness window for the fragment demo. */
  replayWindow: ReplayWindow;
}

const state: State = {
  format: null,
  n: PRESETS[0].n,
  lastEncode: null,
  lastEncodeSignature: null,
  lastPath: null,
  round: null,
  revealed: false,
  tourStep: null,
  classifierPinned: false,
  authRoot: null,
  authRootFor: null,
  lastSeal: null,
  handshakeRoot: null,
  lastFragments: null,
  replayWindow: createWindow()
};

const GAME_GENERATED = 4;
const GAME_REALISTIC = 4;
/** Rows of the length ladder. Enough to show a pattern, few enough to read. */
const LADDER_BYTES = 12;
/** Substitutions per run. ~1s in the browser: PBKDF2 runs once, not per trial. */
const SWAP_TRIALS = 60;
const SWAP_SHOWN = 8;
/** Substitutions fired at the authenticated string. All must be refused. */
const AUTH_ATTACK_TRIALS = 60;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

type StatusKind = "idle" | "ok" | "error" | "working";

/**
 * Status is carried by an icon AND a word AND a colour, never colour alone
 * (WCAG 1.4.1). The icon is aria-hidden because the text beside it already says
 * the same thing.
 */
function setStatus(id: string, kind: StatusKind, text: string): void {
  const row = $(id);
  const icon = row.querySelector(".status-icon") as HTMLElement | null;
  const label = $(`${id}-text`);
  row.classList.remove("is-ok", "is-error", "is-working");
  if (kind === "ok") row.classList.add("is-ok");
  if (kind === "error") row.classList.add("is-error");
  if (kind === "working") row.classList.add("is-working");
  if (icon) icon.textContent = { idle: "·", ok: "✓", error: "✗", working: "…" }[kind];
  label.textContent = text;
}

function setOutput(id: string, text: string, empty: boolean): void {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("is-empty", empty);
}

/** Big integers get an exact reading when short, a scientific one when not. */
export function formatBig(value: bigint): string {
  const digits = value.toString();
  if (digits.length <= 21) return digits;
  return `${digits[0]}.${digits.slice(1, 5)} × 10^${digits.length - 1}`;
}

/** Long hex or long strings: first 8 … last 8, with the true length stated. */
export function abbreviate(text: string, keep = 8): string {
  if (text.length <= keep * 2 + 3) return text;
  return `${text.slice(0, keep)}…${text.slice(-keep)} (${text.length} chars)`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ── Format panel ────────────────────────────────────────────────────────────

function renderFormat(): void {
  const format = state.format;
  const lengthNote = $("length-note");
  if (!format) {
    for (const id of ["stat-states", "stat-classes", "stat-total", "stat-capacity", "stat-n128"]) {
      $(id).textContent = "—";
    }
    lengthNote.textContent = " ";
    return;
  }

  const total = state.n <= MAX_N ? format.counts[state.n] : 0n;
  const capacity = capacityBitsOf(total);
  $("stat-states").textContent = String(format.dfa.stats.states);
  $("stat-classes").textContent = String(format.dfa.stats.classes);
  $("stat-total").textContent = total === 0n ? "0 — no string of this length" : formatBig(total);
  $("stat-capacity").textContent = total === 0n ? "0 bits" : `${capacity} bits`;

  const fit128 = smallestLengthFor(format.counts, 128);
  $("stat-n128").textContent = fit128 === null ? `none up to ${MAX_N}` : `n = ${fit128.n}`;

  const parts = [`Shortest accepted length: n = ${format.shortestN}.`];
  parts.push(
    `Widest slice: n = ${format.maxCapacityN}, ${format.maxCapacityBits} bits. Ceiling n_max = ${MAX_N}.`
  );
  if (total === 0n) parts.push("This pattern accepts nothing of the current length.");
  const bytes = estimateTableBytes(format.dfa, state.n);
  if (bytes > MAX_TABLE_BYTES) {
    parts.push(
      `The count table at this n would need about ${(bytes / 1_048_576).toFixed(1)} MB of BigInt ` +
        `storage, over the ${(MAX_TABLE_BYTES / 1_048_576).toFixed(0)} MB ceiling — encoding here will be refused.`
    );
  }
  lengthNote.textContent = parts.join(" ");
}

/**
 * A table whose header row has no data cells under it fails axe's
 * `th-has-data-cells`, and an empty tbody is exactly that. So the empty state is
 * a real row saying why it is empty, not an absence.
 */
function placeholderRow(body: HTMLElement, columns: number, text: string): void {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = columns;
  td.textContent = text;
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderCounts(): void {
  const body = $("counts-body");
  body.textContent = "";
  const format = state.format;
  const caption = $("counts-caption");
  const note = $("counts-note");
  if (!format) {
    caption.textContent = "C[q0][k] — waiting for a valid pattern.";
    note.textContent = " ";
    placeholderRow(body, 3, "No automaton yet — fix the pattern above.");
    return;
  }

  const last = Math.min(state.n, COUNT_ROWS);
  const rows: number[] = [];
  for (let k = 0; k <= last; k += 1) rows.push(k);
  if (state.n > COUNT_ROWS && state.n <= MAX_N) rows.push(state.n);

  for (const k of rows) {
    const count = format.counts[k] ?? 0n;
    const tr = document.createElement("tr");
    if (k === state.n) tr.className = "is-chosen";
    const cells = [String(k), count === 0n ? "0" : formatBig(count), `${capacityBitsOf(count)} bits`];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  caption.textContent =
    state.n > COUNT_ROWS
      ? `C[q0][k] for k = 0 to ${COUNT_ROWS}, plus the chosen n = ${state.n}.`
      : `C[q0][k] for k = 0 to ${last}. The chosen n = ${state.n} is highlighted.`;
  // The same estimator buildCountTable enforces its 50 MB ceiling with, so the
  // number quoted here is the number that would refuse the build.
  note.textContent = `Table storage at n = ${state.n}: about ${(
    estimateTableBytes(format.dfa, state.n) / 1024
  ).toFixed(1)} KB of BigInt cells (${format.dfa.stats.states} states × ${state.n + 1} lengths).`;
}

function renderGraph(): void {
  const svg = $("dfa-graph") as unknown as SVGSVGElement;
  const body = $("dfa-table-body");
  body.textContent = "";
  const format = state.format;
  if (!format) {
    // Clear the drawing too, not just the table. A picture of the LAST pattern
    // under a status line saying there is no automaton is worse than no picture.
    clearDfa(svg);
    setStatus("dfa-status", "error", "No automaton — fix the pattern above.");
    $("dfa-engine").textContent = "Layout: —";
    placeholderRow(body, 5, "No automaton yet — fix the pattern above.");
    $("dfa-table-caption").textContent = "Transitions appear once the pattern compiles.";
    return;
  }

  const result = renderDfa(svg, format.dfa, GRAPH_STATE_CAP);
  const stats = format.dfa.stats;
  if (result.rendered) {
    setStatus(
      "dfa-status",
      "ok",
      `${stats.states} states, ${stats.transitions} defined transitions, ${stats.classes} alphabet classes. ` +
        `Powerset construction produced ${stats.statesBeforeMinimization}; minimization and trimming left ${stats.states}.`
    );
    $("dfa-engine").textContent = `Layout: ${result.engine}`;
  } else {
    setStatus(
      "dfa-status",
      "working",
      `DFA too large to display: ${result.states} states and ${result.edges} merged edges, over the ${GRAPH_STATE_CAP}-state display cap. ` +
        `The transition table below still lists every one, and encoding is unaffected.`
    );
    $("dfa-engine").textContent = "Layout: not drawn";
  }

  const rows = transitionRows(format.dfa);
  const limit = 400;
  for (const row of rows.slice(0, limit)) {
    const tr = document.createElement("tr");
    for (const value of [
      `q${row.from}`,
      row.label,
      String(row.size),
      `q${row.to}`,
      row.accepting ? "yes" : "no"
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  $("dfa-table-caption").textContent =
    rows.length > limit
      ? `Every defined transition, as (state, class) → state. Showing the first ${limit} of ${rows.length}.`
      : `Every defined transition, as (state, class) → state. ${rows.length} in total.`;
}

function renderCapacityBar(): void {
  const message = ($("encode-message") as HTMLTextAreaElement).value;
  const used = payloadBitsFor(utf8Length(message));
  const format = state.format;
  const available = format ? capacityBitsOf(format.counts[state.n] ?? 0n) : 0;
  const fill = $("capacity-fill");
  const track = $("capacity-track");
  const percent = available === 0 ? 100 : Math.min(100, Math.round((used / available) * 100));
  fill.style.width = `${percent}%`;
  const over = available === 0 || used > available;
  fill.classList.toggle("is-over", over);
  track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute("aria-valuetext", `${used} of ${available} bits used`);
  $("capacity-figures").textContent = `${used} used / ${available} available`;

  const note = $("encode-message-note");
  const bytes = utf8Length(message);
  if (!format) {
    note.textContent = "Waiting for a valid pattern.";
    return;
  }
  if (over) {
    const fit = smallestLengthFor(format.counts, used);
    note.textContent =
      fit === null
        ? `${bytes} bytes needs ${used} bits, and this pattern tops out at ${format.maxCapacityBits} bits (n = ${format.maxCapacityN}). Shorten the message or widen the pattern.`
        : `${bytes} bytes needs ${used} bits — more than n = ${state.n} holds. Encoding will use n = ${fit.n} instead.`;
  } else {
    note.textContent = `${bytes} UTF-8 bytes + 1 frame byte = ${used} bits, inside the ${available} bits n = ${state.n} holds.`;
  }
}

// ── Compile ─────────────────────────────────────────────────────────────────

function recompile(resetLength: boolean): void {
  const pattern = ($("pattern") as HTMLInputElement).value.trim();
  const patternInput = $("pattern") as HTMLInputElement;
  if (pattern.length === 0) {
    state.format = null;
    patternInput.setAttribute("aria-invalid", "true");
    setStatus("format-status", "error", "Enter a regular expression.");
    afterCompile();
    return;
  }
  try {
    const format = compileFormat(pattern);
    state.format = format;
    patternInput.removeAttribute("aria-invalid");
    if (resetLength || (format.counts[state.n] ?? 0n) === 0n) {
      state.n = preferredLength(format);
      ($("length") as HTMLInputElement).value = String(state.n);
    }
    setStatus(
      "format-status",
      "ok",
      `Compiled. |Q| = ${format.dfa.stats.states}, ${format.dfa.stats.classes} alphabet classes, ` +
        `${capacityBitsOf(format.counts[state.n] ?? 0n)} bits of capacity at n = ${state.n}.`
    );
  } catch (error) {
    state.format = null;
    patternInput.setAttribute("aria-invalid", "true");
    setStatus("format-status", "error", (error as Error).message);
  }
  afterCompile();
}

/**
 * The n a freshly compiled pattern lands on.
 *
 * NOT the widest slice. For an open-ended pattern like `[0-9a-f]{1,512}` the
 * widest slice is n = 512, whose count table is 513 states x 513 lengths of
 * BigInt — about 60 MB, over the ceiling — so defaulting to it would hand the
 * reader a length the encoder then refuses. Landing on the shortest n that
 * carries a 128-bit payload gives a useful default (n = 32 for that pattern:
 * 16^32 is exactly 2^128) and a table measured in kilobytes.
 *
 * Patterns that never reach 128 bits — the phone number tops out at 33 — fall
 * back to their widest slice, and the result is clamped to what the table budget
 * can actually hold either way.
 */
function preferredLength(format: CompiledFormat): number {
  const preset = PRESETS.find((p) => p.pattern === format.pattern);
  if (preset && (format.counts[preset.n] ?? 0n) > 0n) return preset.n;
  const target = smallestLengthFor(format.counts, 128);
  const candidate = target !== null ? target.n : format.maxCapacityN;
  return clampToTableBudget(format, candidate > 0 ? candidate : (format.shortestN ?? 0));
}

/** The largest n at or below `candidate` that both accepts strings and fits. */
function clampToTableBudget(format: CompiledFormat, candidate: number): number {
  let n = candidate;
  while (n > 0 && ((format.counts[n] ?? 0n) === 0n || estimateTableBytes(format.dfa, n) > MAX_TABLE_BYTES)) {
    n -= 1;
  }
  return n > 0 ? n : (format.shortestN ?? 0);
}

/**
 * A stego string belongs to one (pattern, n) pair and to no other.
 *
 * Change either and the string on screen is no longer a member of the language
 * the page is now describing — decoding it against the new pattern would fail,
 * or worse, succeed against a different slice and return garbage. So the moment
 * the format moves, the previous result is cleared AND the page says it was
 * retired, rather than leaving a plausible-looking string that quietly belongs
 * to a format nobody is looking at any more.
 *
 * Re-selecting the same preset, or retyping the same pattern, is a no-op: the
 * signature is unchanged, so a fresh result survives. So does the n the encoder
 * itself grew into, because the signature is recorded from the result.
 */
function retireStaleResults(): void {
  if (state.lastEncode === null || state.format === null) return;
  const signature = `${state.format.pattern}|${state.n}`;
  if (signature === state.lastEncodeSignature) return;

  state.lastEncode = null;
  state.lastEncodeSignature = null;
  setOutput("encode-out", "Nothing encoded yet.", true);
  setOutput("encode-bundle", "Nothing encoded yet.", true);
  const list = $("trace-list");
  list.textContent = "";
  const li = document.createElement("li");
  const step = document.createElement("span");
  step.className = "trace-step";
  step.textContent = "Nothing encoded yet";
  li.appendChild(step);
  list.appendChild(li);
  ($("encode-copy") as HTMLButtonElement).disabled = true;
  ($("decode-fill") as HTMLButtonElement).disabled = true;
  setOutput("decode-out", "Nothing decoded yet.", true);
  setStatus("decode-status", "idle", "Idle.");
  // The pipeline, the walk, the highlighted path and the classifier verdicts
  // all describe a string that no longer belongs to this format. Retire them
  // together or the page keeps showing a confident account of nothing.
  clearPipeline();
  clearPathwalk();
  setOutput("quick-out", "Nothing encoded yet.", true);
  setStatus("quick-status", "idle", "Ready.");
  clearClassifier("The format changed — encode again to give the classifier something to look at.");
  setStatus("classifier-status", "idle", "Waiting for a fresh encode.");
  clearSwap("The format changed — encode again to give the attack a string to replace.");
  setStatus("swap-status", "idle", "Waiting for a fresh encode.");
  setStatus(
    "encode-status",
    "idle",
    "Retired the previous stego string: the format changed, so it no longer belongs to this pattern and n. Encode again."
  );
}

function afterCompile(): void {
  retireStaleResults();
  renderFormat();
  renderGraph();
  renderCounts();
  renderCapacityBar();
  renderCurvePanel();
  renderLadder();
  renderBudget();
  renderFragPlan();
  syncClassifierPattern();
  clearGame();
  setStatus("game-status", "idle", "Deal a round to play.");
  const usable = state.format !== null;
  ($("encode-run") as HTMLButtonElement).disabled = !usable;
  ($("decode-run") as HTMLButtonElement).disabled = !usable;
  ($("quick-run") as HTMLButtonElement).disabled = !usable;
  ($("game-deal") as HTMLButtonElement).disabled = !usable;
}

// ── Encode / decode ─────────────────────────────────────────────────────────

function renderTrace(result: EncodeResult): void {
  const list = $("trace-list");
  list.textContent = "";
  const steps: Array<[string, string]> = [
    [
      `PBKDF2-SHA256, ${PBKDF2_ITERATIONS.toLocaleString("en-US")} iterations, salt ${result.saltHex}`,
      `AES-CTR key ${abbreviate(result.trace.messageKeyHex)} · FF1 key ${abbreviate(result.trace.ff1KeyHex)}`
    ],
    [
      `AES-CTR ciphertext (${result.trace.messageBytes} message bytes)`,
      abbreviate(result.trace.ciphertextHex)
    ],
    [
      "Framed as 0x01 ‖ ciphertext, read big-endian → I",
      `${abbreviate(result.trace.integer.toString())} (${result.trace.integerBits} bits)`
    ],
    [
      `Language slice at n = ${result.n}: N = |L ∩ Σ^n|`,
      `${formatBig(result.total)} (${result.capacityBits} bits of capacity)`
    ],
    [
      `FF1 over radix 2, ${result.trace.walkBits}-bit domain, cycle-walked into [0, N)`,
      `${abbreviate(result.trace.ciphered.toString())} after ${result.trace.walkSteps} application${result.trace.walkSteps === 1 ? "" : "s"}`
    ],
    ["Unranked through the DFA → stego string", abbreviate(result.stego, 12)]
  ];
  for (const [step, value] of steps) {
    const li = document.createElement("li");
    const stepEl = document.createElement("span");
    stepEl.className = "trace-step";
    stepEl.textContent = step;
    const valueEl = document.createElement("span");
    valueEl.className = "trace-value";
    valueEl.textContent = value;
    li.append(stepEl, valueEl);
    list.appendChild(li);
  }
}

async function runEncode(): Promise<void> {
  const format = state.format;
  if (!format) return;
  const button = $("encode-run") as HTMLButtonElement;
  const message = ($("encode-message") as HTMLTextAreaElement).value;
  const passphrase = ($("encode-passphrase") as HTMLInputElement).value;
  if (passphrase.length === 0) {
    setStatus("encode-status", "error", "A passphrase is required.");
    return;
  }

  button.disabled = true;
  setStatus(
    "encode-status",
    "working",
    `Deriving keys — ${PBKDF2_ITERATIONS.toLocaleString("en-US")} PBKDF2-SHA256 iterations…`
  );
  try {
    // Fail before spending a second on PBKDF2 when the payload cannot fit at all.
    chooseLength(format, state.n, payloadBitsFor(utf8Length(message)));
    const result = await encode({ format, n: state.n, message, passphrase });
    state.lastEncode = result;
    state.lastEncodeSignature = `${format.pattern}|${result.n}`;

    setOutput("encode-out", result.stego, false);
    setOutput(
      "encode-bundle",
      `pattern  ${format.pattern}\nn        ${result.n}\nsalt     ${result.saltHex}`,
      false
    );
    renderTrace(result);
    renderPipeline(result);
    renderPathwalk(result);
    ($("encode-copy") as HTMLButtonElement).disabled = false;
    ($("decode-fill") as HTMLButtonElement).disabled = false;

    if (result.n !== result.requestedN) {
      state.n = result.n;
      ($("length") as HTMLInputElement).value = String(result.n);
      renderFormat();
      renderCounts();
      setStatus(
        "encode-status",
        "ok",
        `Encoded. The message needed ${result.payloadBits} bits, so n grew from ${result.requestedN} to ${result.n}.`
      );
    } else {
      setStatus(
        "encode-status",
        "ok",
        `Encoded. ${result.payloadBits} of ${result.capacityBits} bits used at n = ${result.n}; the cycle walk took ${result.trace.walkSteps} FF1 application${result.trace.walkSteps === 1 ? "" : "s"}.`
      );
    }
    renderCapacityBar();
    renderCurvePanel();
    // The adversary runs on every fresh encode rather than waiting to be asked.
    // The contrast between the stego string and the raw ciphertext is the point
    // of the page, and a reader should not have to find a second button to see it.
    runClassifier();
  } catch (error) {
    setStatus("encode-status", "error", (error as Error).message);
  } finally {
    button.disabled = state.format === null;
  }
}

async function runDecode(): Promise<void> {
  const format = state.format;
  if (!format) return;
  const button = $("decode-run") as HTMLButtonElement;
  const stego = ($("decode-stego") as HTMLTextAreaElement).value.trim();
  const passphrase = ($("decode-passphrase") as HTMLInputElement).value;
  const saltHex = ($("decode-salt") as HTMLInputElement).value.trim();
  const saltField = $("decode-salt") as HTMLInputElement;

  if (stego.length === 0) {
    setStatus("decode-status", "error", "Paste a stego string to decode.");
    return;
  }
  if (passphrase.length === 0) {
    setStatus("decode-status", "error", "A passphrase is required.");
    return;
  }
  let salt: Uint8Array;
  try {
    salt = hexToBytes(saltHex);
    if (salt.length !== 16) throw new Error("The salt must be exactly 32 hex characters (16 bytes).");
    saltField.removeAttribute("aria-invalid");
  } catch (error) {
    saltField.setAttribute("aria-invalid", "true");
    setStatus("decode-status", "error", (error as Error).message);
    return;
  }

  button.disabled = true;
  setStatus(
    "decode-status",
    "working",
    `Deriving keys — ${PBKDF2_ITERATIONS.toLocaleString("en-US")} PBKDF2-SHA256 iterations…`
  );
  try {
    const result = await decode({ format, stego, passphrase, salt });
    setOutput("decode-out", result.message, result.message.length === 0);
    setStatus(
      "decode-status",
      "ok",
      `Recovered ${utf8Length(result.message)} bytes. Ranked to index ${abbreviate(result.index.toString())} of N = ${formatBig(result.total)}; the inverse walk took ${result.walkSteps} application${result.walkSteps === 1 ? "" : "s"}.`
    );
  } catch (error) {
    setOutput("decode-out", "Nothing decoded.", true);
    setStatus("decode-status", "error", (error as Error).message);
  } finally {
    button.disabled = state.format === null;
  }
}

// ── Pipeline, cycle walk and the path through the automaton ─────────────────

const PIPE_EMPTY: Array<[string, string]> = [
  ["pipe-message-value", "—"],
  ["pipe-cipher-value", "—"],
  ["pipe-integer-value", "—"],
  ["pipe-domain-value", "—"],
  ["pipe-ff1-value", "—"],
  ["pipe-stego-value", "—"]
];

function clearPipeline(): void {
  for (const [id, text] of PIPE_EMPTY) $(id).textContent = text;
  for (const pipe of document.querySelectorAll(".pipe")) pipe.classList.remove("is-live");
  renderWalk($("walk-svg") as unknown as SVGSVGElement, null);
  $("walk-readout").textContent = "Nothing encoded yet.";
}

function renderPipeline(result: EncodeResult): void {
  const t = result.trace;
  const values: Array<[string, string]> = [
    ["pipe-message-value", `${t.messageBytes} UTF-8 byte${t.messageBytes === 1 ? "" : "s"}`],
    ["pipe-cipher-value", abbreviate(t.ciphertextHex)],
    ["pipe-integer-value", `${abbreviate(t.integer.toString())} · ${t.integerBits} bits`],
    ["pipe-domain-value", `${formatBig(result.total)} · ${result.capacityBits} bits`],
    [
      "pipe-ff1-value",
      `${abbreviate(t.ciphered.toString())} after ${t.walkSteps} application${t.walkSteps === 1 ? "" : "s"}`
    ],
    ["pipe-stego-value", abbreviate(result.stego, 12)]
  ];
  for (const [id, text] of values) $(id).textContent = text;
  for (const pipe of document.querySelectorAll(".pipe")) pipe.classList.add("is-live");

  const walk: WalkInput = {
    domain: result.total,
    walkBits: t.walkBits,
    landings: t.walkLandings
  };
  renderWalk($("walk-svg") as unknown as SVGSVGElement, walk);
  // formatBig, so a 116-digit N reads the way the stat grid prints it.
  $("walk-readout").textContent = walkReadout(walk, formatBig(result.total));
}

/**
 * The scrubber over the stego string, and the highlight it drives on the graph.
 *
 * Position 0 is the start state, before any character is consumed; position i
 * is the state reached by consuming character i. That off-by-one is the whole
 * reason the readout names both the character and the state it led to — a
 * reader stepping through should never have to work out which end of the edge
 * they are looking at.
 */
function renderPathAt(position: number): void {
  const path = state.lastPath;
  const svg = $("dfa-graph") as unknown as SVGSVGElement;
  const readout = $("pathwalk-readout");
  const strip = $("pathwalk-string");
  if (!path || path.states.length === 0) {
    clearHighlight(svg);
    return;
  }

  const clamped = Math.max(0, Math.min(position, path.steps.length));
  highlightPath(svg, {
    states: path.states,
    edges: pathEdges(path),
    activeIndex: clamped - 1
  });

  for (const child of strip.children) {
    const index = Number((child as HTMLElement).dataset.index);
    child.classList.toggle("is-current", index === clamped - 1);
    child.classList.toggle("is-past", index < clamped - 1);
  }

  // Bring the current state into view inside the graph's own scroller. Without
  // this the scrubber is close to useless on a long chain: the phone automaton
  // is 15 states wide and most of them sit outside the visible box, so the
  // reader drags the slider and watches nothing move.
  scrollCurrentIntoView(svg, path.states[clamped]);

  const stateNow = path.states[clamped];
  if (clamped === 0) {
    readout.textContent = `Position 0: at the start state q${stateNow}, nothing consumed yet.`;
  } else {
    const step = path.steps[clamped - 1];
    const accepting = path.states.length - 1 === clamped && path.accepted;
    readout.textContent =
      `Character ${clamped} of ${path.steps.length} is "${step.char}": q${step.from} → q${step.to}.` +
      (accepting ? " That is an accepting state — the string is a full match." : "");
  }
}

/**
 * Horizontal-only, and only within the graph wrapper — never
 * `scrollIntoView`, which would also scroll the PAGE and yank the reader away
 * from the slider they are dragging.
 */
function scrollCurrentIntoView(svg: SVGSVGElement, stateId: number): void {
  const wrap = document.getElementById("dfa-graph-wrap");
  const node = svg.querySelector(`[data-state="${stateId}"]`);
  if (!wrap || !node) return;

  const wrapBox = wrap.getBoundingClientRect();
  const nodeBox = node.getBoundingClientRect();
  const margin = 48;
  let delta = 0;
  if (nodeBox.left < wrapBox.left + margin) delta = nodeBox.left - wrapBox.left - margin;
  else if (nodeBox.right > wrapBox.right - margin) delta = nodeBox.right - wrapBox.right + margin;
  if (delta === 0) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  wrap.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" });
}

function clearPathwalk(): void {
  state.lastPath = null;
  const scrub = $("pathwalk-scrub") as HTMLInputElement;
  scrub.disabled = true;
  scrub.min = "0";
  scrub.max = "0";
  scrub.value = "0";
  $("pathwalk-readout").textContent = "Nothing encoded yet.";
  $("pathwalk-string").textContent = "";
  clearHighlight($("dfa-graph") as unknown as SVGSVGElement);
}

function renderPathwalk(result: EncodeResult): void {
  const format = state.format;
  if (!format) return;
  const path = tracePath(format.dfa, result.stego);
  state.lastPath = path;

  const strip = $("pathwalk-string");
  strip.textContent = "";
  Array.from(result.stego).forEach((char, index) => {
    const span = document.createElement("span");
    span.className = "pathchar";
    span.dataset.index = String(index);
    // A space would collapse to nothing in a flex strip, so it gets a visible
    // placeholder glyph. The word goes in as REAL hidden text, not an
    // `aria-label`: a label on a role-less <span> is `aria-prohibited-attr`,
    // silently discarded by some assistive tech and flagged by the gate.
    span.textContent = char === " " ? "␣" : char;
    if (char === " ") {
      const spoken = document.createElement("span");
      spoken.className = "sr-only";
      spoken.textContent = " space";
      span.appendChild(spoken);
    }
    strip.appendChild(span);
  });

  const scrub = $("pathwalk-scrub") as HTMLInputElement;
  scrub.disabled = false;
  scrub.min = "0";
  scrub.max = String(path.steps.length);
  scrub.value = String(path.steps.length);
  renderPathAt(path.steps.length);
}

// ── The classifier ──────────────────────────────────────────────────────────

function clearClassifier(message: string): void {
  const body = $("classifier-body");
  body.textContent = "";
  placeholderRow(body, 4, message);
  $("classifier-summary").textContent = "Nothing classified yet.";
}

function runClassifier(): void {
  const last = state.lastEncode;
  if (!last) {
    setStatus(
      "classifier-status",
      "error",
      "Encode a message first — the classifier needs something to look at."
    );
    clearClassifier("No payload yet — encode a message above.");
    return;
  }

  const input = $("classifier-pattern") as HTMLInputElement;
  let rule: RegExp;
  try {
    rule = compileClassifier(input.value.trim());
    input.removeAttribute("aria-invalid");
  } catch (error) {
    input.setAttribute("aria-invalid", "true");
    setStatus("classifier-status", "error", (error as ClassifierError).message);
    clearClassifier("The classifier rule does not compile.");
    return;
  }

  const rows = classify(rule, payloadsFor(last.stego, last.trace.ciphertextHex));
  const reading = readClassifier(rows);

  const body = $("classifier-body");
  body.textContent = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = row.verdict === "pass" ? "is-pass" : "is-flagged";

    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = row.label;
    tr.appendChild(label);

    const value = document.createElement("td");
    const code = document.createElement("code");
    code.className = "wire";
    code.textContent = abbreviate(row.value, 14);
    value.appendChild(code);
    tr.appendChild(value);

    const verdict = document.createElement("td");
    // Word first, colour second: the verdict must survive greyscale.
    verdict.textContent = row.verdict === "pass" ? "PASS — forwarded" : "FLAGGED — dropped";
    tr.appendChild(verdict);

    const why = document.createElement("td");
    why.textContent = row.reason;
    tr.appendChild(why);

    body.appendChild(tr);
  }

  $("classifier-summary").textContent = reading.summary;
  setStatus(
    "classifier-status",
    reading.textbook ? "ok" : "working",
    reading.textbook
      ? "Stego string through, both raw encodings dropped."
      : "Ran — and the result is not the textbook one. Read the summary below the table."
  );
}

/** Keep the rule mirroring the format until the reader takes it over. */
function syncClassifierPattern(): void {
  if (state.classifierPinned) return;
  const format = state.format;
  ($("classifier-pattern") as HTMLInputElement).value = format ? format.pattern : "";
}

// ── Spot the fake ───────────────────────────────────────────────────────────

/** A uniform BigInt in [0, bound), drawn from the platform CSPRNG. */
function randomBelow(bound: bigint): bigint {
  if (bound <= 1n) return 0n;
  const bits = bound.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  // Rejection sampling: masking to `bits` then rejecting keeps the draw
  // uniform, which a modulo would not. The game is about a uniform
  // distribution, so a biased one here would be quietly self-defeating.
  for (let guard = 0; guard < 1000; guard += 1) {
    crypto.getRandomValues(buf);
    let value = 0n;
    for (const byte of buf) value = (value << 8n) | BigInt(byte);
    value &= (1n << BigInt(bits)) - 1n;
    if (value < bound) return value;
  }
  return bound - 1n;
}

function currentPresetId(): string {
  const format = state.format;
  if (!format) return "custom";
  const preset = PRESETS.find((p) => p.pattern === format.pattern);
  return preset ? preset.id : "custom";
}

function clearGame(): void {
  state.round = null;
  state.revealed = false;
  $("game-list").textContent = "";
  ($("game-reveal") as HTMLButtonElement).disabled = true;
}

function dealRound(): void {
  const format = state.format;
  const list = $("game-list");
  clearGame();

  if (!format) {
    setStatus("game-status", "error", "No automaton — fix the pattern above.");
    return;
  }

  const presetId = currentPresetId();
  const realism = realismFor(presetId);
  if (!("make" in realism)) {
    setStatus("game-status", "idle", realism.why);
    ($("game-deal") as HTMLButtonElement).disabled = false;
    return;
  }

  const total = format.counts[state.n] ?? 0n;
  if (total < BigInt(GAME_GENERATED)) {
    setStatus("game-status", "error", "This slice holds too few strings to draw a round from.");
    return;
  }

  let table;
  try {
    table = buildCountTable(format.dfa, state.n);
  } catch (error) {
    setStatus("game-status", "error", (error as Error).message);
    return;
  }

  // Real unrankings at uniformly random indices — the same function the encoder
  // uses, so these are exactly the strings FTE produces. Nothing is faked.
  const generated: string[] = [];
  const seen = new Set<string>();
  for (let guard = 0; generated.length < GAME_GENERATED && guard < 200; guard += 1) {
    const value = unrank(format.dfa, table, randomBelow(table.total));
    if (seen.has(value)) continue;
    seen.add(value);
    generated.push(value);
  }

  const round = buildRound(presetId, generated, GAME_REALISTIC);
  state.round = round;

  round.candidates.forEach((candidate, index) => {
    const wrap = document.createElement("div");
    wrap.className = "game-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `game-pick-${index}`;
    input.value = candidate.value;

    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = candidate.value;

    const tell = document.createElement("span");
    tell.className = "game-tell";
    tell.id = `game-tell-${index}`;

    wrap.append(input, label, tell);
    list.appendChild(wrap);
  });

  state.revealed = false;
  ($("game-reveal") as HTMLButtonElement).disabled = false;
  setStatus(
    "game-status",
    "idle",
    `${round.candidates.length} candidates, ${round.generatedCount} of them from the encoder. Tick the ones you think it made, then Reveal.`
  );
}

function revealRound(): void {
  const round = state.round;
  if (!round || state.revealed) return;
  state.revealed = true;

  const picked = new Set<string>();
  round.candidates.forEach((candidate, index) => {
    const input = document.getElementById(`game-pick-${index}`) as HTMLInputElement | null;
    if (input?.checked) picked.add(candidate.value);
  });

  const score = scoreRound(round, picked);
  round.candidates.forEach((candidate, index) => {
    const tell = document.getElementById(`game-tell-${index}`);
    if (tell) tell.textContent = candidate.tell;
    const item = tell?.parentElement;
    item?.classList.add(candidate.generated ? "is-generated" : "is-real");
  });

  const missed = score.missed.length;
  setStatus(
    "game-status",
    "ok",
    `${score.correct} of ${score.total} correct. ` +
      (missed === 0
        ? "You caught every generated string — which is the point: a regex could not, and you could."
        : `${missed} generated string${missed === 1 ? "" : "s"} passed as real. That is the gap between "a regex cannot tell" and "nobody can tell".`)
  );
  ($("game-reveal") as HTMLButtonElement).disabled = true;
}

// ── NIST known-answer tests ─────────────────────────────────────────────────

async function runVectors(): Promise<void> {
  const button = $("vectors-run") as HTMLButtonElement;
  const body = $("vectors-body");
  button.disabled = true;
  body.textContent = "";
  setStatus("vectors-status", "working", `Running ${FF1_VECTORS.length} vectors…`);

  const runs: VectorRun[] = [];
  try {
    for (const vector of FF1_VECTORS) {
      const run = await runVector(vector);
      runs.push(run);
      const tr = document.createElement("tr");
      // Three classes, not two: an unsupported vector is neither a pass nor a
      // failure of this code, and painting it red would be a false alarm.
      tr.className =
        run.status === "pass" ? "is-pass" : run.status === "fail" ? "is-flagged" : "is-skipped";

      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = vector.name;
      tr.appendChild(name);

      for (const text of [
        `AES-${vector.keyBits}${vector.tweakHex ? " + tweak" : ""}`,
        String(vector.radix),
        vector.expected,
        run.status === "unsupported" ? "not run here" : run.actual,
        run.status === "pass" ? "PASS" : run.status === "fail" ? "FAIL" : "UNSUPPORTED"
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  } catch (error) {
    setStatus("vectors-status", "error", `The run threw: ${(error as Error).message}`);
    if (body.children.length === 0) placeholderRow(body, 6, "The run stopped before any vector completed.");
    button.disabled = false;
    return;
  }

  const counts = tally(runs);
  const skipped =
    counts.unsupported === 0
      ? ""
      : ` ${counts.unsupported} could not run: WebCrypto has no AES-192, so no browser can reproduce those three — they are covered by the Node test suite, which runs all ${counts.total}.`;

  setStatus(
    "vectors-status",
    counts.failed === 0 ? "ok" : "error",
    counts.failed === 0
      ? `${counts.passed} of ${counts.total} NIST sample vectors reproduced exactly, in this browser, by the same FF1 every encode above uses.${skipped}`
      : `${counts.failed} of ${counts.total} FAILED — this implementation does NOT match SP 800-38G. Do not trust anything else on this page.`
  );
  button.disabled = false;
}

// ── Capacity curve ──────────────────────────────────────────────────────────

function renderCurvePanel(): void {
  const svg = $("curve-svg") as unknown as SVGSVGElement;
  const readout = $("curve-readout");
  const format = state.format;
  if (!format) {
    renderCurve(svg, null);
    readout.textContent = "No automaton — fix the pattern above.";
    return;
  }

  // Cap the plotted range so a 512-length ceiling does not squash the shape of
  // the part anyone is reading.
  const limit = Math.min(MAX_N, Math.max(state.n + 6, format.maxCapacityN + 2, 24));
  const scanned = scanCapacity(format.dfa, limit);
  const capacityByN = scanned.map((total) => capacityBitsOf(total));

  const message = ($("encode-message") as HTMLTextAreaElement).value;
  const requiredBits = payloadBitsFor(utf8Length(message));
  const fit = smallestLengthFor(format.counts, requiredBits);
  const fitN = fit !== null && fit.n <= limit ? fit.n : null;

  const input: CurveInput = { capacityByN, chosenN: state.n, requiredBits, fitN };
  renderCurve(svg, input);

  const atChosen = capacityByN[state.n] ?? 0;
  readout.textContent =
    `Capacity against n, up to ${limit}. At the chosen n = ${state.n} the slice holds ${atChosen} bits; ` +
    `this message needs ${requiredBits}. ` +
    (fitN === null
      ? "No length up to the ceiling holds it — the curve never reaches the line."
      : fitN <= state.n
        ? `It already fits, and would fit from n = ${fitN} upward.`
        : `The curve first crosses the line at n = ${fitN}, which is where the encoder would grow to.`);
}

// ── Guided path ─────────────────────────────────────────────────────────────

function renderTour(): void {
  const panel = $("tour-panel");
  const step = state.tourStep;
  if (step === null) {
    panel.hidden = true;
    ($("tour-start") as HTMLButtonElement).textContent = "Start the guided path";
    return;
  }

  const entry = TOUR[step];
  panel.hidden = false;
  $("tour-index").textContent = String(step + 1);
  $("tour-total").textContent = String(TOUR.length);
  $("tour-title").textContent = entry.title;
  $("tour-body").textContent = entry.body;
  ($("tour-prev") as HTMLButtonElement).disabled = step === 0;
  ($("tour-next") as HTMLButtonElement).textContent =
    step === TOUR.length - 1 ? "Finish" : "Next step";
  ($("tour-start") as HTMLButtonElement).textContent = "Restart the guided path";

  const target = document.getElementById(entry.target);
  if (target) {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
  writeShareState();
}

function moveTour(delta: number): void {
  if (state.tourStep === null) return;
  const next = state.tourStep + delta;
  if (next < 0) return;
  if (next >= TOUR.length) {
    state.tourStep = null;
    renderTour();
    setStatus("labbar-status", "ok", "That is the path. The limitations are the part worth rereading.");
    return;
  }
  state.tourStep = next;
  renderTour();
}

// ── Shareable state ─────────────────────────────────────────────────────────

/**
 * Write the current teaching state into the fragment.
 *
 * `replaceState`, not a hash assignment: the reader is not navigating, and
 * pushing an entry per keystroke would make the back button useless. The
 * passphrase fields are handed to `assertNoSecrets` on every write, so the
 * guarantee is enforced here rather than promised in a comment.
 */
function writeShareState(): void {
  const format = state.format;
  if (!format) return;
  const fragment = encodeState({
    preset: ($("preset") as HTMLSelectElement).value,
    pattern: format.pattern,
    n: state.n,
    message: ($("encode-message") as HTMLTextAreaElement).value,
    classifier: state.classifierPinned
      ? ($("classifier-pattern") as HTMLInputElement).value
      : undefined,
    step: state.tourStep === null ? undefined : state.tourStep + 1
  });

  try {
    assertNoSecrets(fragment, [
      ($("encode-passphrase") as HTMLInputElement).value,
      ($("decode-passphrase") as HTMLInputElement).value,
      ($("quick-passphrase") as HTMLInputElement).value,
      state.lastEncode?.saltHex ?? ""
    ]);
  } catch {
    // Refuse to write rather than publish a passphrase. Silent because the
    // reader did nothing wrong — their message simply contains their key.
    return;
  }

  history.replaceState(null, "", `#${fragment}`);
}

function copyShareLink(): void {
  writeShareState();
  const url = window.location.href;
  void navigator.clipboard?.writeText(url).then(
    () =>
      setStatus(
        "labbar-status",
        "ok",
        "Link copied. It carries the pattern, n, the message and the classifier rule — never a passphrase or a salt."
      ),
    () => setStatus("labbar-status", "error", "The browser refused clipboard access.")
  );
}

// ── Length leakage ──────────────────────────────────────────────────────────

function renderLadder(): void {
  const body = $("leak-body");
  const readout = $("leak-readout");
  body.textContent = "";
  const format = state.format;
  if (!format) {
    placeholderRow(body, 5, "No automaton yet — fix the pattern above.");
    readout.textContent = " ";
    return;
  }

  const ladder: Ladder = buildLadder(format.counts, LADDER_BYTES);
  for (const rung of ladder.rungs) {
    const tr = document.createElement("tr");
    if (rung.n === state.n) tr.className = "is-chosen";

    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = String(rung.messageBytes);
    tr.appendChild(head);

    const others =
      rung.n === null
        ? "—"
        : (() => {
            const sharing = bytesConsistentWith(ladder, rung.n).filter(
              (b) => b !== rung.messageBytes
            );
            return sharing.length === 0
              ? "nothing — this size stands alone on the wire"
              : `${sharing.join(", ")} byte${sharing.length === 1 ? "" : "s"}`;
          })();

    for (const text of [
      String(rung.payloadBits),
      rung.n === null ? "does not fit" : String(rung.n),
      rung.n === null ? "—" : `${rung.n} characters`,
      others
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  readout.textContent = ladderReadout(ladder);
}

// ── Substitution ────────────────────────────────────────────────────────────

function clearSwap(message: string): void {
  const body = $("swap-body");
  body.textContent = "";
  placeholderRow(body, 3, message);
  for (const id of ["swap-frame", "swap-utf8", "swap-accepted", "swap-rate"]) {
    $(id).textContent = "—";
  }
  $("swap-verdict").textContent = "Nothing substituted yet.";
}

async function runSwap(): Promise<void> {
  const format = state.format;
  const last = state.lastEncode;
  const button = $("swap-run") as HTMLButtonElement;
  if (!format || !last) {
    setStatus("swap-status", "error", "Encode a message first — the attack needs a string to replace.");
    return;
  }
  const passphrase = ($("encode-passphrase") as HTMLInputElement).value;
  if (passphrase.length === 0) {
    setStatus("swap-status", "error", "The receiver's passphrase is needed to run their decode.");
    return;
  }

  button.disabled = true;
  setStatus("swap-status", "working", `Substituting ${SWAP_TRIALS} times…`);
  try {
    const table = buildCountTable(format.dfa, last.n);
    // Derived ONCE for the whole run. Per-trial PBKDF2 would take ten minutes.
    const prepared = await prepareDecode(passphrase, last.salt);
    const report = await runSubstitutions(
      format,
      table,
      prepared,
      last.stego,
      SWAP_TRIALS,
      randomBelow
    );

    $("swap-frame").textContent = `${report.rejectedFrame} of ${report.trials.length}`;
    $("swap-utf8").textContent = `${report.rejectedUtf8} of ${report.trials.length}`;
    $("swap-accepted").textContent = `${report.accepted} of ${report.trials.length}`;

    // The cross-check: the share getting PAST the frame byte, measured by
    // actually running the cipher, against the closed form that only counts
    // intervals of [0, N). Two routes, printed side by side.
    const pastFrame = report.accepted + report.rejectedUtf8;
    const measured = report.trials.length === 0 ? 0 : pastFrame / report.trials.length;
    const predicted = frameByteFalseAccept(last.total);
    $("swap-rate").textContent = `${(measured * 100).toFixed(0)}% vs ${(predicted * 100).toFixed(1)}%`;

    const body = $("swap-body");
    body.textContent = "";
    // ACCEPTED trials first. They are the whole point of the panel and, at ~1
    // in 30, a first-eight sample usually contains none of them — which would
    // leave the most important row type invisible behind eight refusals. The
    // figures above still carry the true rates, and the caption says the
    // ordering is deliberate, so nothing here overstates how often it happens.
    const ordered = [
      ...report.trials.filter((t) => t.outcome === "accepted"),
      ...report.trials.filter((t) => t.outcome !== "accepted")
    ];
    for (const trial of ordered.slice(0, SWAP_SHOWN)) {
      const tr = document.createElement("tr");
      tr.className = trial.outcome === "accepted" ? "is-flagged" : "is-pass";

      const head = document.createElement("th");
      head.scope = "row";
      head.textContent = trial.stego;
      tr.appendChild(head);

      const what =
        trial.outcome === "accepted"
          ? "ACCEPTED — handed it over as a message"
          : trial.outcome === "rejected-frame"
            ? "Refused — no frame byte"
            : "Refused — not valid UTF-8";
      const got =
        trial.outcome === "accepted"
          ? JSON.stringify(trial.message ?? "")
          : "nothing";

      for (const text of [what, got]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    if (report.trials.length > SWAP_SHOWN) {
      placeholderRow(
        body,
        3,
        `…and ${report.trials.length - SWAP_SHOWN} more, counted in the figures above.`
      );
    }
    $("swap-caption").textContent =
      report.accepted === 0
        ? `A sample of the substitutions and what the receiver did with each. None was accepted this run.`
        : `A sample of the substitutions. The ${report.accepted} the receiver ACCEPTED are listed first, because they are the ones that matter — the figures above give the true rates.`;

    // Note the inversion of the usual reading: an ACCEPTED row is the bad news
    // here. The receiver taking a substituted string is the failure.
    //
    // The one thing that must NEVER happen is a substitution returning the real
    // message. Confidentiality does not depend on the frame byte, so this is
    // checked rather than assumed — if it ever fired, something far worse than
    // a missing MAC would be wrong.
    const sent = ($("encode-message") as HTMLTextAreaElement).value;
    const leaked = report.trials.some((t) => t.message !== null && t.message === sent);
    if (leaked) {
      setStatus(
        "swap-status",
        "error",
        "A substituted string returned the original message. That must never happen — stop trusting this page."
      );
      return;
    }

    $("swap-verdict").textContent =
      report.accepted === 0
        ? `Every one of the ${report.trials.length} substitutions was refused — this time. ${(predicted * 100).toFixed(0)}% of them still got past the frame byte and were caught only by the UTF-8 check, which is a coincidence of encoding, not a signature check. Run it again: the rate is what matters, not the run.`
        : `${report.accepted} of ${report.trials.length} substituted strings were ACCEPTED and handed to the reader as a message. None of them is what you sent, and the receiver has no way to know that. A MAC would have caught all ${report.trials.length}.`;

    setStatus(
      "swap-status",
      "ok",
      `${report.trials.length} substitutions. None returned your message; ${report.accepted} returned something else the receiver could not tell apart from one.`
    );
  } catch (error) {
    setStatus("swap-status", "error", (error as Error).message);
  } finally {
    button.disabled = false;
  }
}

// ── The authenticated mode ──────────────────────────────────────────────────

function currentTagBytes(): TagBytes {
  const raw = Number(($("auth-tag") as HTMLSelectElement).value);
  return (TAG_CHOICES as readonly number[]).includes(raw) ? (raw as TagBytes) : 8;
}

/**
 * The budget table: why a phone number cannot carry an authenticated message.
 *
 * Every figure comes from `budget()`, the same function `seal` refuses on, so
 * the table cannot promise a message size the encoder would then reject.
 */
/**
 * Capacity per preset, compiled once and remembered.
 *
 * The presets never change, but this runs on every recompile — which is every
 * keystroke in the pattern box. Compiling four DFAs and their count tables each
 * time (twice each, as the first draft did) is real work to repeat for a
 * constant.
 */
const capacityMemo = new Map<string, number>();

function presetCapacity(id: string, pattern: string, n: number, declared: number): number {
  const cached = capacityMemo.get(id);
  if (cached !== undefined) return cached;
  let bits = declared;
  try {
    const counts = compileFormat(pattern).counts;
    if (counts[n] !== undefined) bits = capacityBitsOf(counts[n]);
  } catch {
    // Fall back to the label, which `e2e/claims.spec.ts` pins to the live DFA.
  }
  capacityMemo.set(id, bits);
  return bits;
}

function renderBudget(): void {
  const body = $("budget-body");
  body.textContent = "";

  for (const preset of PRESETS) {
    const capacityBits = presetCapacity(preset.id, preset.pattern, preset.n, preset.bits);

    const tr = document.createElement("tr");
    if (state.format?.pattern === preset.pattern) tr.className = "is-chosen";

    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = preset.label;
    tr.appendChild(head);

    const cells = [`${capacityBits} bits`, `${Math.floor(capacityBits / 8) - 1} bytes`];
    for (const tagBytes of TAG_CHOICES) {
      const b = budget(capacityBits, tagBytes);
      cells.push(b.fits ? `${b.maxMessageBytes} bytes` : "does not fit");
    }
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  const tagBytes = currentTagBytes();
  const format = state.format;
  const note = $("budget-note");
  if (!format) {
    note.textContent = "No automaton — fix the pattern above.";
    return;
  }
  const b = budget(capacityBitsOf(format.counts[state.n] ?? 0n), tagBytes);
  note.textContent = b.fits
    ? `Your current format and n hold ${b.maxMessageBytes} bytes of authenticated message: ${b.payloadBytes} whole bytes of capacity, minus the frame byte, minus a ${tagBytes}-byte tag, minus the one byte padding always costs.`
    : `Your current format cannot carry an authenticated message at this tag size: ${b.payloadBytes} whole bytes of capacity against ${b.overheadBytes} of overhead. Switch to hex or base64, or shorten the tag.`;
  $("auth-tag-note").textContent = `A ${8 * tagBytes}-bit tag gives a forger one chance in 2^${8 * tagBytes} per attempt.`;
}

/** PBKDF2 once per passphrase. Item 3, made visible in the status line. */
async function rootFor(passphrase: string): Promise<Uint8Array> {
  if (state.authRoot && state.authRootFor === passphrase) return state.authRoot;
  setStatus(
    "auth-status",
    "working",
    `New passphrase — running PBKDF2 once (${PBKDF2_ITERATIONS.toLocaleString("en-US")} iterations). Every message after this is HKDF.`
  );
  const root = await deriveRoot(passphrase);
  state.authRoot = root;
  state.authRootFor = passphrase;
  return root;
}

function renderAuthTrace(result: SealResult): void {
  const list = $("auth-trace-list");
  list.textContent = "";
  const steps: Array<[string, string]> = [
    ["Root key, then HKDF ratcheted to this counter", `counter ${result.counter} · AES key ${abbreviate(result.trace.aesKeyHex)}`],
    ["FF1 tweak, derived from the counter — not shipped", result.trace.tweakHex],
    [`AES-CTR over a fixed ${result.trace.plaintextBytes}-byte padded block`, abbreviate(result.trace.ciphertextHex)],
    [`HMAC-SHA256 over counter ‖ ciphertext, truncated to ${result.trace.tagBytes} bytes`, result.trace.tagHex],
    ["Framed 0x01 ‖ ciphertext ‖ tag, read big-endian", `${abbreviate(result.trace.integer.toString())}`],
    [`FF1 cycle-walked into [0, N), N = ${formatBig(result.total)}`, `${result.trace.walkSteps} application${result.trace.walkSteps === 1 ? "" : "s"}`],
    ["Unranked branchlessly through the DFA", abbreviate(result.stego, 14)]
  ];
  for (const [step, value] of steps) {
    const li = document.createElement("li");
    const stepEl = document.createElement("span");
    stepEl.className = "trace-step";
    stepEl.textContent = step;
    const valueEl = document.createElement("span");
    valueEl.className = "trace-value";
    valueEl.textContent = value;
    li.append(stepEl, valueEl);
    list.appendChild(li);
  }
}

async function runSeal(): Promise<void> {
  const format = state.format;
  if (!format) return;
  const message = ($("auth-message") as HTMLInputElement).value;
  const passphrase = ($("auth-passphrase") as HTMLInputElement).value;
  const counter = Number(($("auth-counter") as HTMLInputElement).value);
  if (passphrase.length === 0) {
    setStatus("auth-status", "error", "A passphrase is required.");
    return;
  }

  const button = $("auth-seal") as HTMLButtonElement;
  button.disabled = true;
  try {
    const root = await rootFor(passphrase);
    setStatus("auth-status", "working", "Sealing…");
    const result = await authSeal({
      format,
      n: state.n,
      root,
      counter,
      message,
      tagBytes: currentTagBytes()
    });
    state.lastSeal = result;
    setOutput("auth-out", result.stego, false);
    renderAuthTrace(result);
    ($("auth-message-note")).textContent =
      `${new TextEncoder().encode(message).length} bytes, padded to ${result.budget.plaintextBytes}. Every message in this mode produces a string of exactly ${result.stego.length} characters.`;
    setStatus(
      "auth-status",
      "ok",
      `Sealed at counter ${result.counter}. Nothing else travels — no salt, no sequence number.`
    );
    $("auth-verdict").textContent = "Now attack it. The unauthenticated mode accepted about one substitution in thirty.";
  } catch (error) {
    state.lastSeal = null;
    setOutput("auth-out", "Nothing sealed.", true);
    setStatus(
      "auth-status",
      "error",
      error instanceof CapacityError ? error.message : (error as Error).message
    );
  } finally {
    button.disabled = false;
  }
}

async function runOpen(): Promise<void> {
  const format = state.format;
  const sealed = state.lastSeal;
  if (!format || !sealed) {
    setStatus("auth-status", "error", "Seal something first.");
    return;
  }
  const button = $("auth-open") as HTMLButtonElement;
  button.disabled = true;
  try {
    const root = await rootFor(($("auth-passphrase") as HTMLInputElement).value);
    // Deliberately from zero, to show the receiver resynchronising without
    // being told the counter.
    const opened = await authOpen(format, sealed.stego, root, 0, currentTagBytes());
    setStatus(
      "auth-status",
      "ok",
      `Opened "${opened.message}" — the receiver started at 0 and found counter ${opened.counter} after ${opened.searched} attempt${opened.searched === 1 ? "" : "s"}, without being told it.`
    );
  } catch (error) {
    setStatus("auth-status", "error", (error as AuthError).message);
  } finally {
    button.disabled = false;
  }
}

/**
 * The same attack the unauthenticated panel runs, pointed at the sealed string.
 * The comparison is the whole point, so the wording quotes both outcomes.
 */
async function runAuthAttack(): Promise<void> {
  const format = state.format;
  const sealed = state.lastSeal;
  if (!format || !sealed) {
    setStatus("auth-status", "error", "Seal something first — the attack needs a string to replace.");
    return;
  }
  const button = $("auth-attack") as HTMLButtonElement;
  button.disabled = true;
  setStatus("auth-status", "working", `Substituting ${AUTH_ATTACK_TRIALS} times…`);
  try {
    const root = await rootFor(($("auth-passphrase") as HTMLInputElement).value);
    const table = buildCountTable(format.dfa, sealed.n);
    const tagBytes = currentTagBytes();

    let accepted = 0;
    for (let i = 0; i < AUTH_ATTACK_TRIALS; i += 1) {
      const candidate = unrank(format.dfa, table, randomBelow(table.total));
      if (candidate === sealed.stego) continue;
      try {
        await authOpen(format, candidate, root, 0, tagBytes, 4);
        accepted += 1;
      } catch {
        // Refused, as it must be.
      }
    }

    $("auth-verdict").textContent =
      accepted === 0
        ? `${AUTH_ATTACK_TRIALS} substitutions, ${accepted} accepted. The unauthenticated mode above accepts roughly one in thirty of exactly the same attack; a ${8 * tagBytes}-bit tag puts the odds at one in 2^${8 * tagBytes} per attempt. That difference is the entire content of the third limitation.`
        : `${accepted} of ${AUTH_ATTACK_TRIALS} substitutions were ACCEPTED. That must not happen — at a ${8 * tagBytes}-bit tag the expected count is essentially zero. Something is wrong.`;
    setStatus(
      "auth-status",
      accepted === 0 ? "ok" : "error",
      `${AUTH_ATTACK_TRIALS} substitutions, ${accepted} accepted.`
    );
  } catch (error) {
    setStatus("auth-status", "error", (error as Error).message);
  } finally {
    button.disabled = false;
  }
}

// ── Key agreement ───────────────────────────────────────────────────────────

function shortHex(text: string, keep = 10): string {
  return text.length <= keep * 2 ? text : `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

async function runHandshake(): Promise<void> {
  const button = $("hs-run") as HTMLButtonElement;
  const body = $("hs-body");
  button.disabled = true;
  setStatus("hs-status", "working", "Generating two key pairs…");
  try {
    const suite = await bestSuite();
    const alice = await generateIdentity(suite);
    const bob = await generateIdentity(suite);

    // Each side derives from its OWN private key and the OTHER's public key.
    const a = await agree(alice, bob.publicKeyHex);
    const b = await agree(bob, alice.publicKeyHex);
    const match = a.root.length === b.root.length && a.root.every((byte, i) => byte === b.root[i]);

    body.textContent = "";
    for (const [name, id, root] of [
      ["Alice", alice, a.root],
      ["Bob", bob, b.root]
    ] as Array<[string, Identity, Uint8Array]>) {
      const tr = document.createElement("tr");
      const head = document.createElement("th");
      head.scope = "row";
      head.textContent = name;
      tr.appendChild(head);
      for (const text of [
        shortHex(id.publicKeyHex),
        shortHex(Array.from(root, (byte) => byte.toString(16).padStart(2, "0")).join(""))
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    state.handshakeRoot = match ? a.root : null;
    $("hs-verdict").textContent = match
      ? `Both sides derived the same root from public keys alone — nothing secret crossed the channel. Suite: ${suite}, ${suite === "X25519" ? 32 : 65}-byte public keys. The fragments below now use this root instead of a passphrase.`
      : "The two roots differ, which should be impossible. Do not trust this exchange.";
    setStatus(
      "hs-status",
      match ? "ok" : "error",
      match ? `${suite} exchange complete; the roots match.` : "The roots do not match."
    );
  } catch (error) {
    setStatus("hs-status", "error", (error as Error).message);
  } finally {
    button.disabled = false;
  }
}

// ── Fragments ───────────────────────────────────────────────────────────────

/** The root the fragment demo uses: the exchanged one when there is one. */
async function fragmentRoot(): Promise<Uint8Array> {
  if (state.handshakeRoot) return state.handshakeRoot;
  return rootFor(($("auth-passphrase") as HTMLInputElement).value || "correct horse battery staple");
}

function renderFragPlan(): void {
  const format = state.format;
  const note = $("frag-plan");
  if (!format) {
    note.textContent = "No automaton — fix the pattern above.";
    return;
  }
  const message = ($("frag-message") as HTMLInputElement).value;
  const bytes = utf8Length(message);
  const capacity = capacityBitsOf(format.counts[state.n] ?? 0n);
  const p = plan(capacity, currentTagBytes(), bytes);
  note.textContent = p.fits
    ? `${bytes} bytes plus a ${currentTagBytes()}-byte tag and a 2-byte length is a ${p.blobBytes}-byte blob. At ${p.payloadBytes} bytes a string — ${p.firstChunk} in the first, ${p.restChunk} after — that is ${p.fragments} string${p.fragments === 1 ? "" : "s"}.`
    : (p.reason ?? "This message cannot be fragmented into this format.");
}

async function runFragSeal(): Promise<void> {
  const format = state.format;
  if (!format) return;
  const button = $("frag-seal") as HTMLButtonElement;
  button.disabled = true;
  setStatus("frag-status", "working", "Sealing…");
  try {
    const sealed = await sealFragments({
      format,
      n: state.n,
      root: await fragmentRoot(),
      baseCounter: 0,
      message: ($("frag-message") as HTMLInputElement).value,
      tagBytes: currentTagBytes()
    });
    state.lastFragments = sealed;
    state.replayWindow = createWindow();
    setOutput("frag-out", sealed.strings.join("\n"), false);
    setStatus(
      "frag-status",
      "ok",
      `${sealed.strings.length} string${sealed.strings.length === 1 ? "" : "s"}, one tag over all of them. Each one is a valid member of the format on its own.`
    );
    setStatus("replay-status", "idle", "Fresh window. Open the fragments, then try again.");
    $("replay-window").textContent = describeWindow(state.replayWindow);
  } catch (error) {
    state.lastFragments = null;
    setOutput("frag-out", "Nothing sealed.", true);
    setStatus("frag-status", "error", (error as Error).message);
  } finally {
    button.disabled = false;
  }
}

async function runFragOpen(strings: string[], statusId: string, useWindow: boolean): Promise<void> {
  const format = state.format;
  if (!format) return;
  try {
    const opened = await openFragments(
      format,
      strings,
      await fragmentRoot(),
      0,
      currentTagBytes(),
      16,
      useWindow ? state.replayWindow : undefined
    );
    if (useWindow) {
      state.replayWindow = accept(state.replayWindow, opened.baseCounter);
      $("replay-window").textContent = describeWindow(state.replayWindow);
    }
    setStatus(
      statusId,
      "ok",
      `Reassembled ${opened.fragments} fragments into "${opened.message}" at base counter ${opened.baseCounter}.`
    );
  } catch (error) {
    setStatus(statusId, "error", (error as Error).message);
  }
}

async function runFragTamper(): Promise<void> {
  const format = state.format;
  const sealed = state.lastFragments;
  if (!format || !sealed) {
    setStatus("frag-status", "error", "Seal something first.");
    return;
  }
  const table = buildCountTable(format.dfa, state.n);
  const swapped = [...sealed.strings];
  const at = Math.floor(sealed.strings.length / 2);
  // A different, perfectly valid member of the language — the substitution the
  // unauthenticated mode cannot detect.
  let replacement = unrank(format.dfa, table, randomBelow(table.total));
  while (replacement === swapped[at]) {
    replacement = unrank(format.dfa, table, randomBelow(table.total));
  }
  swapped[at] = replacement;

  try {
    await openFragments(format, swapped, await fragmentRoot(), 0, currentTagBytes(), 16);
    setStatus("frag-status", "error", "The tampered set was ACCEPTED. That must not happen.");
  } catch {
    setStatus(
      "frag-status",
      "ok",
      `Replaced fragment ${at + 1} of ${sealed.strings.length} with a different valid ${state.format?.pattern === PRESETS[0].pattern ? "phone number" : "member of the format"} — refused. One tag covers the whole message, so tampering with any single piece fails all of it.`
    );
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────

function debounce(fn: () => void, ms: number): () => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(fn, ms);
  };
}

/**
 * The hero encoder.
 *
 * It owns no cryptography of its own. It copies its two fields into the main
 * encode panel and calls the same `runEncode`, then mirrors the result — so the
 * two encoders physically cannot disagree, and the reader who scrolls down
 * finds the full trace of the very string the hero just showed them.
 */
async function runQuickEncode(): Promise<void> {
  const message = ($("quick-message") as HTMLInputElement).value;
  const passphrase = ($("quick-passphrase") as HTMLInputElement).value;
  if (passphrase.length === 0) {
    setStatus("quick-status", "error", "A passphrase is required.");
    return;
  }

  ($("encode-message") as HTMLTextAreaElement).value = message;
  ($("encode-passphrase") as HTMLInputElement).value = passphrase;
  renderCapacityBar();

  const button = $("quick-run") as HTMLButtonElement;
  button.disabled = true;
  setStatus("quick-status", "working", "Deriving keys and enciphering…");
  try {
    await runEncode();
    const result = state.lastEncode;
    if (!result) {
      // runEncode already wrote the reason into the encode panel; echo it here
      // rather than inventing a second, possibly different explanation.
      setStatus("quick-status", "error", $("encode-status-text").textContent ?? "Encoding failed.");
      setOutput("quick-out", "Nothing encoded yet.", true);
      return;
    }
    setOutput("quick-out", result.stego, false);
    const verdict = $("classifier-status-text").textContent ?? "";
    setStatus(
      "quick-status",
      "ok",
      `That is ${result.trace.messageBytes} byte${result.trace.messageBytes === 1 ? "" : "s"} of AES-CTR ciphertext wearing a phone number. ${verdict}`
    );
  } finally {
    button.disabled = state.format === null;
  }
}

export function initUI(root: HTMLElement): void {
  root.innerHTML = template();
  root.setAttribute("tabindex", "-1");

  const presetSelect = $("preset") as HTMLSelectElement;
  const patternInput = $("pattern") as HTMLInputElement;
  const lengthInput = $("length") as HTMLInputElement;

  const applyPreset = (id: string): void => {
    const preset = PRESETS.find((p) => p.id === id);
    $("preset-note").textContent = preset ? preset.note : "Custom pattern — capacity is computed live.";
    if (!preset) return;
    patternInput.value = preset.pattern;
    state.n = preset.n;
    lengthInput.value = String(preset.n);
    recompile(false);
  };

  presetSelect.addEventListener("change", () => applyPreset(presetSelect.value));

  patternInput.addEventListener(
    "input",
    debounce(() => {
      if (!PRESETS.some((p) => p.pattern === patternInput.value)) {
        presetSelect.value = "custom";
        $("preset-note").textContent = "Custom pattern — capacity is computed live.";
      }
      recompile(true);
    }, 180)
  );

  lengthInput.addEventListener("input", () => {
    const value = Number(lengthInput.value);
    if (!Number.isInteger(value) || value < 0 || value > MAX_N) {
      lengthInput.setAttribute("aria-invalid", "true");
      return;
    }
    lengthInput.removeAttribute("aria-invalid");
    state.n = value;
    retireStaleResults();
    renderFormat();
    renderCounts();
    renderCapacityBar();
  });

  ($("encode-message") as HTMLTextAreaElement).addEventListener("input", renderCapacityBar);
  $("encode-run").addEventListener("click", () => void runEncode());
  $("decode-run").addEventListener("click", () => void runDecode());

  $("encode-copy").addEventListener("click", () => {
    const text = $("encode-out").textContent ?? "";
    void navigator.clipboard?.writeText(text).then(
      () => setStatus("encode-status", "ok", "Stego string copied to the clipboard."),
      () => setStatus("encode-status", "error", "The browser refused clipboard access.")
    );
  });

  $("decode-fill").addEventListener("click", () => {
    const last = state.lastEncode;
    if (!last) return;
    ($("decode-stego") as HTMLTextAreaElement).value = last.stego;
    ($("decode-salt") as HTMLInputElement).value = last.saltHex;
    ($("decode-passphrase") as HTMLInputElement).value = (
      $("encode-passphrase") as HTMLInputElement
    ).value;
    setStatus(
      "decode-status",
      "ok",
      "Filled the stego string, the salt and the passphrase from the encode above. In a real deployment those last two arrive out of band."
    );
  });

  // ── Hero encoder ──────────────────────────────────────────────────────────
  $("quick-run").addEventListener("click", () => void runQuickEncode());

  // ── Path scrubber ─────────────────────────────────────────────────────────
  ($("pathwalk-scrub") as HTMLInputElement).addEventListener("input", (event) => {
    renderPathAt(Number((event.target as HTMLInputElement).value));
  });

  // ── Classifier ────────────────────────────────────────────────────────────
  const classifierInput = $("classifier-pattern") as HTMLInputElement;
  classifierInput.addEventListener("input", () => {
    // Once touched, the rule is the reader's; stop mirroring the format into it.
    state.classifierPinned = true;
  });
  $("classifier-run").addEventListener("click", runClassifier);
  $("classifier-reset").addEventListener("click", () => {
    state.classifierPinned = false;
    syncClassifierPattern();
    classifierInput.removeAttribute("aria-invalid");
    runClassifier();
  });

  // ── Spot the fake ─────────────────────────────────────────────────────────
  $("swap-run").addEventListener("click", () => void runSwap());

  // ── The authenticated mode ────────────────────────────────────────────────
  $("auth-seal").addEventListener("click", () => void runSeal());
  $("auth-open").addEventListener("click", () => void runOpen());
  $("auth-attack").addEventListener("click", () => void runAuthAttack());

  // ── Key agreement, fragments, freshness ───────────────────────────────────
  $("hs-run").addEventListener("click", () => void runHandshake());
  ($("frag-message") as HTMLInputElement).addEventListener("input", renderFragPlan);
  $("frag-seal").addEventListener("click", () => void runFragSeal());
  $("frag-open").addEventListener("click", () => {
    const sealed = state.lastFragments;
    if (!sealed) {
      setStatus("frag-status", "error", "Seal something first.");
      return;
    }
    void runFragOpen(sealed.strings, "frag-status", false);
  });
  $("frag-tamper").addEventListener("click", () => void runFragTamper());
  $("replay-open").addEventListener("click", () => {
    const sealed = state.lastFragments;
    if (!sealed) {
      setStatus("replay-status", "error", "Seal some fragments first.");
      return;
    }
    void runFragOpen(sealed.strings, "replay-status", true);
  });
  $("replay-again").addEventListener("click", () => {
    const sealed = state.lastFragments;
    if (!sealed) {
      setStatus("replay-status", "error", "Seal some fragments first.");
      return;
    }
    void runFragOpen(sealed.strings, "replay-status", true);
  });
  $("replay-reset").addEventListener("click", () => {
    state.replayWindow = createWindow();
    $("replay-window").textContent = describeWindow(state.replayWindow);
    setStatus("replay-status", "idle", "Window reset — the same strings will be accepted again.");
  });
  ($("auth-tag") as HTMLSelectElement).addEventListener("change", renderBudget);
  ($("auth-passphrase") as HTMLInputElement).addEventListener("input", () => {
    // A changed passphrase invalidates the cached root; the next seal pays
    // PBKDF2 again, and only then.
    state.authRoot = null;
    state.authRootFor = null;
  });
  $("game-deal").addEventListener("click", dealRound);
  $("game-reveal").addEventListener("click", revealRound);

  // ── NIST vectors ──────────────────────────────────────────────────────────
  $("vectors-run").addEventListener("click", () => void runVectors());

  // ── Guided path ───────────────────────────────────────────────────────────
  $("tour-start").addEventListener("click", () => {
    state.tourStep = 0;
    renderTour();
  });
  $("tour-prev").addEventListener("click", () => moveTour(-1));
  $("tour-next").addEventListener("click", () => moveTour(1));
  $("tour-end").addEventListener("click", () => {
    state.tourStep = null;
    renderTour();
    setStatus("labbar-status", "idle", "Path ended. Everything stays where it is.");
  });

  // ── Share ─────────────────────────────────────────────────────────────────
  $("share-copy").addEventListener("click", copyShareLink);

  // Arrival state: the first preset, compiled, with the capacity bar showing a
  // real message already in the box — unless a shared link says otherwise.
  const shared = decodeState(window.location.hash);
  const sharedPreset = PRESETS.find((p) => p.id === shared.preset);
  presetSelect.value = sharedPreset ? sharedPreset.id : PRESETS[0].id;
  ($("encode-message") as HTMLTextAreaElement).value = shared.message ?? "hi";
  ($("quick-message") as HTMLInputElement).value = shared.message ?? "hi";
  ($("auth-message") as HTMLInputElement).value = "meet at six";
  ($("frag-message") as HTMLInputElement).value = "meet me at six";
  applyPreset(presetSelect.value);

  // A shared pattern may be a custom one, and a shared n may differ from the
  // preset's. Apply them after the preset so they win, and recompile once.
  if (shared.pattern !== undefined && shared.pattern !== patternInput.value) {
    patternInput.value = shared.pattern;
    if (!PRESETS.some((p) => p.pattern === shared.pattern)) {
      presetSelect.value = "custom";
      $("preset-note").textContent = "Custom pattern — capacity is computed live.";
    }
    recompile(true);
  }
  if (shared.n !== undefined && shared.n <= MAX_N && state.format !== null) {
    if ((state.format.counts[shared.n] ?? 0n) > 0n) {
      state.n = shared.n;
      lengthInput.value = String(shared.n);
      renderFormat();
      renderCounts();
      renderCapacityBar();
      renderCurvePanel();
    }
  }
  if (shared.classifier !== undefined) {
    state.classifierPinned = true;
    ($("classifier-pattern") as HTMLInputElement).value = shared.classifier;
  }
  if (shared.step !== undefined && shared.step >= 1 && shared.step <= TOUR.length) {
    state.tourStep = shared.step - 1;
    renderTour();
  }

  clearClassifier("No payload yet — encode a message above.");
  clearSwap("No stego string yet — encode a message above.");
  // An empty tbody under a header row is `th-has-data-cells`, so the not-yet-run
  // state is a real row saying so — the same rule the count table follows.
  placeholderRow($("vectors-body"), 6, "Not run yet — press the button above.");
  placeholderRow($("hs-body"), 3, "No exchange yet — press the button above.");
  $("replay-window").textContent = describeWindow(state.replayWindow);
}
