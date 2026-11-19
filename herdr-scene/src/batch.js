// Shapes -> as few paint layers as the picture allows. Each layer becomes one
// native path, which is what keeps a GPUI frame cheap; a layer of boxes (see
// quad.js) becomes boxes, which cost less still.
//
// A shape joins the latest layer with its look unless a later layer it
// overlaps would then be painted under it, or (for fills) it overlaps a shape
// already in that layer: a fill path draws overlapping subpaths even-odd, so
// two would cancel out. Boxes are drawn one by one, so they may overlap.

import { cmdCount } from "./scene.js";
import { asBoxes } from "./quad.js";

const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * @typedef {object} Layer
 * @property {string} key
 * @property {"fill"|"stroke"|"box"} kind
 * @property {string} paint
 * @property {number} opacity
 * @property {number} [width]
 * @property {number[]|null} [dash]
 * @property {import("./scene.js").Shape[]} shapes
 */

/** @param {import("./scene.js").Shape[]} shapes @returns {Layer[]} */
export function batch(shapes) {
  const layers = [];
  const byKey = new Map();
  for (const s of shapes) {
    const op = s.opacity ?? 1;
    const key = s.kind === "box" ? "box" : s.kind === "fill" ? `f|${s.paint}|${op}` : `s|${s.paint}|${op}|${s.width}|${s.dash?.join(",") ?? ""}`;
    const cands = byKey.get(key) ?? [];
    let target = null;
    for (let i = cands.length - 1; i >= 0 && !target; i--) {
      const L = cands[i];
      let blocked = false;
      for (let j = L.index + 1; j < layers.length && !blocked; j++) {
        if (layers[j].key !== key && layers[j].boxes.some((b) => overlaps(b, s.box))) blocked = true;
      }
      if (blocked) break; // older layers with this key lie lower still
      if (s.kind === "fill" && L.boxes.some((b) => overlaps(b, s.box))) continue;
      target = L;
    }
    if (!target) {
      target = { key, kind: s.kind, paint: s.paint, opacity: op, width: s.width, dash: s.dash, index: layers.length, shapes: [], boxes: [] };
      layers.push(target);
      cands.push(target);
      byKey.set(key, cands);
    }
    target.shapes.push(s);
    target.boxes.push(s.box);
  }
  return layers;
}

// A box is one element of a few calls, about as much work as this many path commands.
const BOX_COST = 4;

/**
 * Splits layers and text lines into pieces of bounded work, in paint order:
 * a renderer that draws each piece in its own pass (Herdr times each render)
 * gets at most `cmds` path commands or `texts` lines per pass.
 */
export function chunk(layers, texts, { cmds: maxCmds = 1000, texts: maxTexts = 100 } = {}) {
  const out = [];
  let cur = null, cmds = 0;
  for (const L of layers) {
    let part = null;
    for (const s of L.shapes) {
      if (!cur || cmds >= maxCmds) {
        out.push((cur = { parts: [] }));
        cmds = 0;
        part = null;
      }
      if (!part) cur.parts.push((part = { layer: L, shapes: [] }));
      part.shapes.push(s);
      cmds += s.kind === "box" ? BOX_COST : cmdCount(s.cmds);
    }
  }
  for (let i = 0; i < texts.length; i += maxTexts) out.push({ texts: [i, Math.min(texts.length, i + maxTexts)] });
  return out;
}

// Text's footprint, from the same estimate the renderer sizes its boxes by.
function textBox(t) {
  let chars = 0;
  for (const s of t.spans) chars += s.text.length;
  const half = Math.max(20, chars * t.size * 0.35);
  const x0 = t.anchor === "middle" ? t.x - half : t.anchor === "end" ? t.x - half * 2 : t.x;
  return { x0, y0: t.y - t.size, x1: x0 + half * 2, y1: t.y + t.size * 0.3 };
}

const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });

/**
 * Pieces of bounded work grouped by where they are: shapes by the `tile` their
 * box's middle falls in (batched there, paint order kept), then text the same
 * way. Each piece has the `box` it covers, so a renderer can skip the ones
 * off screen. Shapes in different tiles can overlap near a border; they paint
 * tile by tile there.
 */
export function chunkSpatial(shapes, texts, { tile = 1200, cmds = 1000, texts: maxTexts = 100 } = {}) {
  const at = (b) => `${Math.floor((b.y0 + b.y1) / 2 / tile)},${Math.floor((b.x0 + b.x1) / 2 / tile)}`;
  const order = (m) => [...m.entries()].sort(([a], [b]) => {
    const [ay, ax] = a.split(",").map(Number), [by, bx] = b.split(",").map(Number);
    return ay - by || ax - bx;
  });
  const shapeTiles = new Map();
  for (const s of asBoxes(shapes)) {
    const k = at(s.box);
    if (!shapeTiles.has(k)) shapeTiles.set(k, []);
    shapeTiles.get(k).push(s);
  }
  const out = [];
  for (const [, group] of order(shapeTiles)) {
    for (const c of chunk(batch(group), [], { cmds })) {
      let box = null;
      for (const p of c.parts) for (const s of p.shapes) box = union(box, s.box);
      out.push({ ...c, box });
    }
  }
  const textTiles = new Map();
  texts.forEach((t, i) => {
    const b = textBox(t), k = at(b);
    if (!textTiles.has(k)) textTiles.set(k, []);
    textTiles.get(k).push([i, b]);
  });
  for (const [, group] of order(textTiles)) {
    for (let i = 0; i < group.length; i += maxTexts) {
      const part = group.slice(i, i + maxTexts);
      out.push({ texts: part.map(([j]) => j), box: part.reduce((b, [, tb]) => union(b, tb), null) });
    }
  }
  return out;
}
