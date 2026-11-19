// mermaid's path from text to what the host draws. "pele" is aliased at
// build time: the fork (after) or upstream pele (before), which has no
// renderScene, so it goes through SVG text and svgToScene as mermaid did.
import * as pele from "pele";
import { svgToScene } from "../../src/svg.js";
import { SceneCanvas } from "../../src/gpui.js";
import { paletteFromTheme } from "../../src/paint.js";
import { visibleArea } from "../../src/viewport.js";
import { THEME } from "../theme.js";

// As src/mermaid.js does; that module imports the minified dist bundle, which
// would leave a profile without names.
export function model(src) {
  if (typeof pele.renderScene !== "function") return svgToScene(pele.render(src, { sourceInfo: true }).svg);
  const opts = { sourceInfo: true };
  const m = pele.parse(src, opts);
  if (pele.sceneSupported(m)) return pele.renderScene(m, opts).scene;
  return svgToScene(pele.render(m, opts).svg);
}

// A cx that runs nothing later: the drawing below is what its tasks would ask for.
const cx = { spawn() {}, notify() {}, stop_propagation() {} };

// Canvases register themselves until disposed, and the app makes one per view,
// not one per drawing: the bench lets a few live at a time.
const live = [];

// The first drawing at the fitted view: pieces made, and those on screen drawn.
export function paint(scene, size) {
  const c = new SceneCanvas({});
  live.push(c);
  if (live.length > 16) live.shift().dispose();
  c.set(scene);
  c.size = size;
  const v = c.currentView();
  c.drawn = { key: "bench", z: v.z, palette: paletteFromTheme(THEME) };
  const area = visibleArea(v, size, 0.25);
  c.chunks.forEach((ch, i) => {
    if (ch.box && ch.box.x0 <= area.x1 && area.x0 <= ch.box.x1 && ch.box.y0 <= area.y1 && area.y0 <= ch.box.y1) c.inView.add(i);
  });
  const out = [];
  for (const i of c.inView) out.push(c.drawChunk(i, c.gen));
  return { canvas: c, out };
}

// A zoom step: the pieces on screen drawn again at the new zoom (set() is not
// run again: the scene is the same).
export function zoom(drawn, k) {
  const c = drawn.canvas;
  const v0 = c.currentView();
  c.view = { z: v0.z * k, x: v0.x, y: v0.y };
  const v = c.currentView();
  c.drawn = { key: `bench${v.z}`, z: v.z, palette: c.drawn.palette };
  const area = visibleArea(v, c.size, 0.25);
  c.inView = new Set();
  c.chunks.forEach((ch, i) => {
    if (ch.box && ch.box.x0 <= area.x1 && area.x0 <= ch.box.x1 && ch.box.y0 <= area.y1 && area.y0 <= ch.box.y1) c.inView.add(i);
  });
  const out = [];
  for (const i of c.inView) out.push(c.drawChunk(i, c.gen));
  return out;
}

// A later frame (hover, a status change): the canvas element over drawn pieces.
export function frame(drawn) {
  return drawn.canvas.element(THEME, cx);
}
