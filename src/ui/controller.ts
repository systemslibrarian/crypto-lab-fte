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
  payloadBitsFor
} from "../fte.ts";
import {
  MAX_N,
  MAX_TABLE_BYTES,
  capacityBitsOf,
  estimateTableBytes,
  smallestLengthFor
} from "../rank.ts";
import { hexToBytes } from "../ff1.ts";
import { PBKDF2_ITERATIONS } from "../keys.ts";
import { clearDfa, renderDfa, transitionRows } from "../dfaview.ts";
import { PRESETS, template } from "./template.ts";

const COUNT_ROWS = 20;
const GRAPH_STATE_CAP = 64;

interface State {
  format: CompiledFormat | null;
  n: number;
  lastEncode: EncodeResult | null;
  /** `pattern|n` the last encode was produced under. See `retireStaleResults`. */
  lastEncodeSignature: string | null;
}

const state: State = { format: null, n: PRESETS[0].n, lastEncode: null, lastEncodeSignature: null };

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
  const usable = state.format !== null;
  ($("encode-run") as HTMLButtonElement).disabled = !usable;
  ($("decode-run") as HTMLButtonElement).disabled = !usable;
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

// ── Boot ────────────────────────────────────────────────────────────────────

function debounce(fn: () => void, ms: number): () => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(fn, ms);
  };
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

  // Arrival state: the first preset, compiled, with the capacity bar showing a
  // real message already in the box.
  presetSelect.value = PRESETS[0].id;
  ($("encode-message") as HTMLTextAreaElement).value = "hi";
  applyPreset(PRESETS[0].id);
}
