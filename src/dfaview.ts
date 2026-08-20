/**
 * The minimized DFA, drawn.
 *
 * The picture is the mechanism, not decoration: every circle is a state the
 * counting DP has a column for, every edge label is one alphabet equivalence
 * class, and the double ring marks the accepting states whose C[0] entry is 1.
 * Reading the graph and reading the count table are the same act.
 *
 * Layout comes from dagre if the page managed to load it (layered, left to
 * right — the right shape for an automaton), otherwise from d3-force, otherwise
 * from a built-in BFS layering. All three are optional: the built-in path means
 * the page still draws a correct graph with no network at all, which is what
 * makes the CDN tags an enhancement rather than a dependency.
 *
 * The graph is `role="img"` with a summary label, and the panel pairs it with a
 * real transition table — a force-directed picture is not an accessible name for
 * a transition relation.
 */

import { Dfa } from "./regex/dfa.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_R = 20;
const ACCEPT_INNER_R = 15;

export type LayoutEngine = "dagre" | "d3-force" | "built-in";

export interface RenderResult {
  rendered: boolean;
  engine: LayoutEngine | null;
  states: number;
  edges: number;
}

interface Edge {
  from: number;
  to: number;
  label: string;
}

interface Point {
  x: number;
  y: number;
}

interface DagreLike {
  graphlib: { Graph: new () => DagreGraph };
  layout: (g: DagreGraph) => void;
}
interface DagreGraph {
  setGraph: (opts: Record<string, unknown>) => void;
  setDefaultEdgeLabel: (fn: () => Record<string, unknown>) => void;
  setNode: (id: string, value: Record<string, unknown>) => void;
  setEdge: (from: string, to: string, value?: Record<string, unknown>) => void;
  node: (id: string) => { x: number; y: number };
}
interface D3Like {
  forceSimulation: <T>(nodes: T[]) => D3Simulation<T>;
  forceLink: <T>(links: T[]) => D3Force;
  forceManyBody: () => D3Force;
  forceCenter: (x: number, y: number) => D3Force;
  forceCollide: (r: number) => D3Force;
}
interface D3Simulation<T> {
  force: (name: string, force: D3Force) => D3Simulation<T>;
  stop: () => D3Simulation<T>;
  tick: (n?: number) => D3Simulation<T>;
}
interface D3Force {
  id?: (fn: (d: { index: number }) => number) => D3Force;
  distance?: (d: number) => D3Force;
  strength?: (s: number) => D3Force;
}

/** Collapse parallel class-edges between the same pair into one labelled edge. */
export function collectEdges(dfa: Dfa): Edge[] {
  const merged = new Map<string, { from: number; to: number; labels: string[] }>();
  for (let q = 0; q < dfa.numStates; q += 1) {
    for (const cls of dfa.classes) {
      const t = dfa.delta[q * dfa.classes.length + cls.index];
      if (t < 0) continue;
      const key = `${q}->${t}`;
      const entry = merged.get(key);
      if (entry) entry.labels.push(cls.label);
      else merged.set(key, { from: q, to: t, labels: [cls.label] });
    }
  }
  return Array.from(merged.values()).map((e) => ({
    from: e.from,
    to: e.to,
    label: e.labels.join(", ")
  }));
}

/** Rows for the text alternative: one line per (state, class) transition. */
export function transitionRows(
  dfa: Dfa
): Array<{ from: number; label: string; to: number; size: number; accepting: boolean }> {
  const rows: Array<{ from: number; label: string; to: number; size: number; accepting: boolean }> =
    [];
  for (let q = 0; q < dfa.numStates; q += 1) {
    for (const cls of dfa.classes) {
      const t = dfa.delta[q * dfa.classes.length + cls.index];
      if (t < 0) continue;
      rows.push({ from: q, label: cls.label, to: t, size: cls.size, accepting: dfa.accepting[t] });
    }
  }
  return rows;
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function layoutWithDagre(dfa: Dfa, edges: Edge[], dagre: DagreLike): Point[] | null {
  try {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 46, ranksep: 84, marginx: 36, marginy: 36 });
    g.setDefaultEdgeLabel(() => ({}));
    for (let q = 0; q < dfa.numStates; q += 1) {
      g.setNode(String(q), { width: NODE_R * 2, height: NODE_R * 2 });
    }
    for (const e of edges) if (e.from !== e.to) g.setEdge(String(e.from), String(e.to));
    dagre.layout(g);
    const points: Point[] = [];
    for (let q = 0; q < dfa.numStates; q += 1) {
      const node = g.node(String(q));
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
      points.push({ x: node.x, y: node.y });
    }
    return points;
  } catch {
    return null;
  }
}

function layoutWithD3(dfa: Dfa, edges: Edge[], d3: D3Like): Point[] | null {
  try {
    const nodes = Array.from({ length: dfa.numStates }, (_, i) => ({
      index: i,
      x: 60 + (i % 8) * 90,
      y: 60 + Math.floor(i / 8) * 90
    }));
    const links = edges
      .filter((e) => e.from !== e.to)
      .map((e) => ({ source: nodes[e.from], target: nodes[e.to] }));
    const sim = d3.forceSimulation(nodes);
    sim.force("link", d3.forceLink(links).distance?.(110) ?? d3.forceLink(links));
    sim.force("charge", d3.forceManyBody().strength?.(-460) ?? d3.forceManyBody());
    sim.force("center", d3.forceCenter(480, 220));
    sim.force("collide", d3.forceCollide(NODE_R * 2));
    sim.stop();
    sim.tick(320);
    if (!nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))) return null;
    return nodes.map((n) => ({ x: n.x, y: n.y }));
  } catch {
    return null;
  }
}

/**
 * BFS layering: column = distance from q0, row = order within the column. Plain,
 * deterministic, and always available — the layout the page falls back to when
 * neither CDN script loaded.
 */
function layoutBuiltIn(dfa: Dfa, edges: Edge[]): Point[] {
  const depth = new Array<number>(dfa.numStates).fill(-1);
  depth[dfa.start] = 0;
  const queue = [dfa.start];
  const outgoing = new Map<number, number[]>();
  for (const e of edges) {
    const list = outgoing.get(e.from);
    if (list) list.push(e.to);
    else outgoing.set(e.from, [e.to]);
  }
  while (queue.length > 0) {
    const q = queue.shift() as number;
    for (const t of outgoing.get(q) ?? []) {
      if (depth[t] < 0) {
        depth[t] = depth[q] + 1;
        queue.push(t);
      }
    }
  }
  const columns = new Map<number, number[]>();
  for (let q = 0; q < dfa.numStates; q += 1) {
    const d = depth[q] < 0 ? 0 : depth[q];
    const col = columns.get(d);
    if (col) col.push(q);
    else columns.set(d, [q]);
  }
  const points = new Array<Point>(dfa.numStates);
  for (const [d, members] of columns) {
    members.forEach((q, i) => {
      points[q] = { x: 60 + d * 130, y: 60 + i * 84 };
    });
  }
  return points;
}

function normalize(points: Point[]): { points: Point[]; width: number; height: number } {
  const pad = 48;
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const shifted = points.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad }));
  const width = Math.max(...shifted.map((p) => p.x)) + pad;
  const height = Math.max(...shifted.map((p) => p.y)) + pad;
  return { points: shifted, width, height };
}

/**
 * Draw the DFA into `svg`. Returns `rendered: false` when the automaton is over
 * `maxStates`, so the caller can print the counts instead of a hairball.
 */
/**
 * Empty the diagram.
 *
 * Called when the pattern stops compiling. Without it the previous pattern's
 * automaton stays on screen underneath a status line reading "No automaton",
 * which is the same class of lie as a stale stego string: a picture that is
 * true of a format nobody is looking at any more.
 */
export function clearDfa(svg: SVGSVGElement): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.removeAttribute("viewBox");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
}

export function renderDfa(svg: SVGSVGElement, dfa: Dfa, maxStates = 64): RenderResult {
  clearDfa(svg);
  const edges = collectEdges(dfa);
  if (dfa.numStates > maxStates) {
    return { rendered: false, engine: null, states: dfa.numStates, edges: edges.length };
  }

  const globals = globalThis as unknown as { dagre?: DagreLike; d3?: D3Like };
  let engine: LayoutEngine = "built-in";
  let raw: Point[] | null = null;
  if (globals.dagre) {
    raw = layoutWithDagre(dfa, edges, globals.dagre);
    if (raw) engine = "dagre";
  }
  if (!raw && globals.d3?.forceSimulation) {
    raw = layoutWithD3(dfa, edges, globals.d3);
    if (raw) engine = "d3-force";
  }
  if (!raw) raw = layoutBuiltIn(dfa, edges);

  const { points, width, height } = normalize(raw);
  svg.setAttribute("viewBox", `0 0 ${Math.round(width)} ${Math.round(height)}`);
  svg.setAttribute("width", String(Math.round(width)));
  svg.setAttribute("height", String(Math.round(height)));

  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = el("marker", {
    id: "dfa-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse"
  });
  const arrowPath = el("path", { d: "M 0 0 L 10 5 L 0 10 z" });
  arrowPath.setAttribute("fill", "var(--border-strong)");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const edgeLayer = document.createElementNS(SVG_NS, "g");
  const nodeLayer = document.createElementNS(SVG_NS, "g");
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);

  const hasReverse = new Set(edges.map((e) => `${e.from}->${e.to}`));

  for (const e of edges) {
    const a = points[e.from];
    const b = points[e.to];
    if (e.from === e.to) {
      const path = el("path", {
        d: `M ${a.x - 10} ${a.y - NODE_R} C ${a.x - 44} ${a.y - 66}, ${a.x + 44} ${a.y - 66}, ${a.x + 10} ${a.y - NODE_R}`,
        class: "dfa-edge",
        "data-edge": `${e.from}->${e.to}`,
        "marker-end": "url(#dfa-arrow)"
      });
      edgeLayer.appendChild(path);
      const label = el("text", { x: a.x, y: a.y - 62, class: "dfa-edge-label", "text-anchor": "middle" });
      label.textContent = e.label;
      edgeLayer.appendChild(label);
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const start = { x: a.x + ux * NODE_R, y: a.y + uy * NODE_R };
    const end = { x: b.x - ux * (NODE_R + 6), y: b.y - uy * (NODE_R + 6) };
    // Bow the edge when the reverse edge also exists, so the pair stays legible.
    const bow = hasReverse.has(`${e.to}->${e.from}`) ? 16 : 0;
    const mid = {
      x: (start.x + end.x) / 2 - uy * bow,
      y: (start.y + end.y) / 2 + ux * bow
    };
    const path = el("path", {
      d: `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`,
      class: "dfa-edge",
      "data-edge": `${e.from}->${e.to}`,
      "marker-end": "url(#dfa-arrow)"
    });
    edgeLayer.appendChild(path);
    const label = el("text", {
      x: mid.x,
      y: mid.y - 6,
      class: "dfa-edge-label",
      "text-anchor": "middle"
    });
    label.textContent = e.label;
    edgeLayer.appendChild(label);
  }

  for (let q = 0; q < dfa.numStates; q += 1) {
    const p = points[q];
    const circle = el("circle", {
      cx: p.x,
      cy: p.y,
      r: NODE_R,
      "data-state": q,
      class: q === dfa.start ? "dfa-node dfa-node-start" : "dfa-node"
    });
    nodeLayer.appendChild(circle);
    if (dfa.accepting[q]) {
      nodeLayer.appendChild(
        el("circle", { cx: p.x, cy: p.y, r: ACCEPT_INNER_R, class: "dfa-node-accept-ring" })
      );
    }
    const text = el("text", { x: p.x, y: p.y, class: "dfa-node-label" });
    text.textContent = `q${q}`;
    nodeLayer.appendChild(text);
  }

  return { rendered: true, engine, states: dfa.numStates, edges: edges.length };
}

// ── Path highlighting ───────────────────────────────────────────────────────

/**
 * Light up the route one string takes through the drawing.
 *
 * The graph and the stego string are the two strongest things on the page and
 * they used to ignore each other. Highlighting closes that: the reader watches
 * their own phone number walk the automaton one character at a time, and the
 * count table stops being an abstraction about "the language" and becomes an
 * account of the paths through this picture.
 *
 * Highlighting is applied as classes on elements the render pass already
 * tagged, so it costs no relayout and cannot move a node. It is also purely
 * additive — the underlying drawing is unchanged and `clearHighlight` restores
 * it exactly, which matters because the graph is `role="img"` with a fixed text
 * alternative that must stay true whatever is lit up.
 */
export function clearHighlight(svg: SVGSVGElement): void {
  for (const node of svg.querySelectorAll(".is-on-path, .is-current")) {
    node.classList.remove("is-on-path", "is-current");
  }
}

export interface HighlightInput {
  /** States visited, in order. */
  states: number[];
  /** Directed edges used, as "from->to". */
  edges: Set<string>;
  /**
   * Which character the scrubber is on, or null for "show the whole path".
   * At index i the current state is states[i + 1] — the state reached by
   * consuming character i.
   */
  activeIndex: number | null;
}

export function highlightPath(svg: SVGSVGElement, input: HighlightInput): void {
  clearHighlight(svg);
  if (input.states.length === 0) return;

  for (const state of new Set(input.states)) {
    svg.querySelector(`[data-state="${state}"]`)?.classList.add("is-on-path");
  }
  for (const edge of input.edges) {
    for (const path of svg.querySelectorAll(`[data-edge="${edge}"]`)) {
      path.classList.add("is-on-path");
    }
  }

  const cursor =
    input.activeIndex === null
      ? input.states[input.states.length - 1]
      : input.states[Math.min(input.activeIndex + 1, input.states.length - 1)];
  svg.querySelector(`[data-state="${cursor}"]`)?.classList.add("is-current");
}
