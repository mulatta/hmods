// Blueprint's path from text to what the host draws, run from its own files
// ("blueprint" is aliased to the installed mod at build time). A Blueprint
// view is made without the host: only the fields its drawing reads are set.
import Blueprint from "blueprint/main.js";
import { parseFlowchart } from "blueprint/mermaid.js";
import { layout } from "blueprint/layout.js";
import { THEME } from "../theme.js";

// main.js keeps these to itself; copied from Blueprint 0.3.6.
function nodeSize(n, m) {
  switch (n.shape) {
    case "diamond": return { w: Math.max(2 * m.w + 28, 110), h: Math.max(2 * m.h + 22, 70) };
    case "circle": { const d = Math.max(m.w, m.h) + 40; return { w: d, h: d }; }
    case "cylinder": return { w: Math.max(m.w + 44, 120), h: m.h + 42 };
    case "stadium": return { w: Math.max(m.w + 56, 120), h: Math.max(m.h + 26, 52) };
    default: return { w: Math.max(m.w + 40, 120), h: Math.max(m.h + 26, 52) };
  }
}
const PAL = { active: THEME.working, done: THEME.done };

function view(size) {
  const bp = Object.create(Blueprint.prototype);
  return Object.assign(bp, {
    measured: {}, vers: {}, paths: {}, zoom: 1, tab: 0, mono: "Menlo", size,
    selected: null, hovered: null, editing: false, compose: null, exporting: false, paneFocused: false,
    deadline: Infinity, graphs: [],
  });
}

// As Blueprint's prepare does for the diagram on screen: both directions laid
// out (it shows the one that fits the pane better), with what a render looks up.
export function model(src) {
  const bp = view({ width: 1200, height: 800 });
  const g = parseFlowchart(src);
  bp.graphs = [{ key: "bench", rev: 0, g }];
  const mk = bp.mkey(0);
  const laid = {};
  for (const dir of [g.dir, g.dir === "LR" ? "TB" : "LR"]) {
    const L = Object.assign(layout(g, dir, (n) => nodeSize(n, bp.labelBox(mk, n)), (e) => bp.edgeLabelBox(mk, g, e)), { g, mk });
    bp.reach(L);
    bp.scope(L);
    laid[dir] = L;
  }
  return { bp, L: laid[g.dir] };
}

// Blueprint reads a subset of flowchart syntax and takes anything else as one.
export const flowchartOnly = true;

// The first drawing at the fitted view.
export function paint({ bp, L }, size) {
  bp.size = size;
  bp.paths = {};
  const cur = { L, v: bp.fitView(L) };
  return { bp, cur, out: bp.drawing(THEME, PAL, cur) };
}

// A zoom step: the edges and grid are built again for the new view.
export function zoom(drawn, k) {
  const { v } = drawn.cur;
  drawn.cur = { L: drawn.cur.L, v: { z: v.z * k, x: v.x, y: v.y } };
  return drawn.bp.drawing(THEME, PAL, drawn.cur);
}

// A later frame: the grid and edge paths are kept, the boxes are made again.
export function frame(drawn) {
  return drawn.bp.drawing(THEME, PAL, drawn.cur);
}
