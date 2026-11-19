import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneBuilder, SCENE_VERSION, M, L, C, Q, A, Z, parsePath, cmdsBox, roundRect, batch, chunk, resolvePaint, withAlpha, fit, zoomAt, hitTest, toScene, itemsInRect, pickWith, openWith } from "../src/index.js";

const PALETTE = { _bg: "#101010", _fg: "#eeeeee", _s: "#202020", _a: "#303030" };

test("the builder keeps paint order, gives every shape a box and every item the union", () => {
  const b = new SceneBuilder(0, 0, 100, 50);
  b.begin("A", "node");
  b.path(roundRect(10, 10, 20, 10, 2), { fill: "var(--_s)", stroke: "var(--_b)", width: 2 });
  b.text(20, 18, [{ text: "A" }], { size: 10, anchor: "middle" });
  b.end();
  b.path([M, 40, 15, L, 60, 15], { stroke: "var(--_l)", dash: [4, 4] });
  const s = b.done();
  assert.equal(s.version, SCENE_VERSION);
  assert.deepEqual(s.shapes.map((x) => [x.kind, x.item]), [["fill", 0], ["stroke", 0], ["stroke", -1]]);
  assert.deepEqual(s.shapes[1].box, { x0: 9, y0: 9, x1: 31, y1: 21 });
  assert.deepEqual(s.shapes[2].dash, [4, 4]);
  assert.equal(s.texts[0].item, 0);
  assert.equal(s.items[0].box.x0, 10);
  assert.equal(s.items[0].box.x1, 30);
});

test("path data with relative, smooth and packed-arc commands becomes absolute", () => {
  assert.deepEqual(parsePath("M10 10q5 0 5 5t5 5"), [M, 10, 10, Q, 15, 10, 15, 15, Q, 15, 20, 20, 20]);
  assert.deepEqual(parsePath("M0,0A4,4 0 01 8,8H2V3Z", 1, 2), [M, 1, 2, A, 4, 4, 0, 0, 1, 9, 10, L, 3, 10, L, 3, 5, Z]);
  assert.deepEqual(cmdsBox(parsePath("M0 0L10 5")), { x0: 0, y0: 0, x1: 10, y1: 5 });
});

test("paint tokens resolve against the palette and keep alpha", () => {
  assert.equal(resolvePaint("var(--_s)", PALETTE), "#202020");
  assert.equal(resolvePaint("var(--pele-fg-on-dark,#fff)", PALETTE), "#ffffff");
  assert.equal(resolvePaint("color-mix(in srgb,var(--_a) 50%,var(--_bg))", PALETTE), "#303030");
  assert.equal(resolvePaint("none", PALETTE), null);
  assert.equal(withAlpha("#ffffff", 0.5), "#ffffff80");
});

test("batching merges same-look shapes but never paints one under a later overlap", () => {
  const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const s = (paint, b) => ({ kind: "fill", paint, opacity: 1, box: b, cmds: [], item: -1 });
  const layers = batch([
    s("#a", box(0, 0, 10, 10)),
    s("#b", box(5, 5, 15, 15)),
    s("#a", box(20, 20, 30, 30)),
    s("#a", box(8, 8, 12, 12)),
    s("#b", box(40, 40, 50, 50)),
    s("#b", box(45, 45, 55, 55)),
  ]);
  assert.deepEqual(layers.map((l) => `${l.paint}:${l.shapes.length}`), ["#a:2", "#b:2", "#a:1", "#b:1"]);
});

test("fit centers the scene, zoom keeps the pointer still, hit tests pick the smallest box", () => {
  const scene = { x: 0, y: 0, w: 100, h: 50, items: [{ id: "big", box: { x0: 0, y0: 0, x1: 100, y1: 50 } }, { id: "small", box: { x0: 10, y0: 10, x1: 20, y1: 20 } }] };
  const v = fit(scene, 248, 148, 24, 10);
  assert.equal(v.z, 2);
  assert.deepEqual([v.x, v.y], [24, 24]);
  const p = { x: 50, y: 60 };
  const before = toScene(v, p), after = toScene(zoomAt(v, 1.7, p), p);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(hitTest(scene, v, { x: 24 + 15 * 2, y: 24 + 15 * 2 }), 1);
  assert.equal(hitTest(scene, v, { x: 24 + 80 * 2, y: 24 + 40 * 2 }), 0);
  assert.equal(hitTest(scene, v, { x: 0, y: 0 }), -1);
});

test("chunks bound the commands and lines per piece and keep paint order", () => {
  const shape = (n) => ({ cmds: Array.from({ length: n }, () => [L, 0, 0]).flat() });
  const A = { paint: "a", shapes: [shape(3), shape(3), shape(3)] };
  const B = { paint: "b", shapes: [shape(2)] };
  const pieces = chunk([A, B], new Array(5).fill({}), { cmds: 5, texts: 2 });
  assert.deepEqual(pieces.map((p) => p.parts?.map((x) => `${x.layer.paint}${x.shapes.length}`) ?? p.texts),
    [["a2"], ["a1", "b1"], [0, 2], [2, 4], [4, 5]]);
});

test("a box picks the nodes it touches, but links and groups only when it holds them whole", () => {
  const item = (kind, x0, y0, x1, y1) => ({ id: kind, kind, box: { x0, y0, x1, y1 } });
  const scene = { items: [
    item("pele-node", 0, 0, 10, 10),
    item("pele-node", 50, 50, 60, 60),
    item("pele-edge", 5, 5, 55, 55),
    item("pele-cluster", -5, -5, 70, 70),
    item("pele-edge", 2, 2, 8, 8),
  ] };
  assert.deepEqual(itemsInRect(scene, { x0: 8, y0: 8, x1: 20, y1: 20 }), [0]);
  // Corners in any order.
  assert.deepEqual(itemsInRect(scene, { x0: 20, y0: 20, x1: -1, y1: -1 }), [0, 4]);
  assert.deepEqual(itemsInRect(scene, { x0: -10, y0: -10, x1: 80, y1: 80 }), [0, 1, 2, 3, 4]);
  // A sequence diagram's loop or rect holds its messages as a group does; a rect-shaped node is a node.
  const blocks = { items: [item("pele-frame pele-frame-loop", -5, -5, 70, 70), item("pele-rect", -5, -5, 70, 70), item("pele-node pele-shape-rect", 0, 0, 10, 10)] };
  assert.deepEqual(itemsInRect(blocks, { x0: 8, y0: 8, x1: 20, y1: 20 }), [2]);
});

test("picks: a plain pick replaces, Cmd or Shift adds, Option takes away, in pick order", () => {
  const none = { shift: false, platform: false, alt: false, control: false };
  assert.deepEqual(pickWith([1, 2], [3], none), [3]);
  assert.deepEqual(pickWith([1, 2], [], none), []);
  assert.deepEqual(pickWith([1, 2], [3, 1], { ...none, platform: true }), [1, 2, 3]);
  assert.deepEqual(pickWith([1, 2], [4], { ...none, shift: true }), [1, 2, 4]);
  assert.deepEqual(pickWith([1, 2, 3], [2, 9], { ...none, alt: true }), [1, 3]);
  // Option wins over Cmd: taking away is the deliberate gesture.
  assert.deepEqual(pickWith([1, 2], [2], { ...none, alt: true, platform: true }), [1]);
});

test("a diagram too big to read whole is shown at a readable zoom from its start", async () => {
  const { readableFit } = await import("../src/viewport.js");
  const tall = { x: 0, y: 0, w: 400, h: 4000, items: [] };
  // Whole: z = 0.1, too small for minZ 0.5; filling the width would be 1.2: readable is enough.
  const v = readableFit(tall, 500, 500, 10, 1.5, 0.5);
  assert.equal(v.z, 0.5);
  assert.equal(v.y, 10); // top aligned
  assert.equal(v.x, (500 - 400 * 0.5) / 2); // centered across
  // A thin strip: filling its short side is below minZ, so it fills it.
  const strip = readableFit({ x: 0, y: 0, w: 4000, h: 100, items: [] }, 500, 200, 10, 1.5, 2);
  assert.equal(strip.z, 1.5);
  assert.equal(strip.x, 10);
  // Small enough: the plain fit.
  assert.deepEqual(readableFit({ x: 0, y: 0, w: 100, h: 100, items: [] }, 500, 500, 10, 1.5, 0.5), fit({ x: 0, y: 0, w: 100, h: 100 }, 500, 500, 10, 1.5));
});

test("spatial chunks keep far parts apart, paint order within a part, and text after shapes", async () => {
  const { chunkSpatial } = await import("../src/batch.js");
  const sh = (paint, x, y) => ({ kind: "fill", paint, opacity: 1, cmds: [M, x, y, L, x + 10, y, Z], box: { x0: x, y0: y, x1: x + 10, y1: y + 10 }, item: -1 });
  const shapes = [sh("#a", 0, 0), sh("#b", 5000, 0), sh("#c", 20, 0)];
  const texts = [{ x: 5, y: 5, size: 10, spans: [{ text: "hi" }] }, { x: 5005, y: 5, size: 10, spans: [{ text: "far" }] }];
  const out = chunkSpatial(shapes, texts, { tile: 1000 });
  const paths = out.filter((c) => c.parts), words = out.filter((c) => c.texts);
  assert.equal(out.indexOf(words[0]) > out.indexOf(paths[paths.length - 1]), true);
  assert.deepEqual(paths.map((c) => c.parts.map((p) => p.layer.paint).join("")), ["#a#c", "#b"]);
  assert.deepEqual(paths[0].box, { x0: 0, y0: 0, x1: 30, y1: 10 });
  assert.deepEqual(words.map((c) => c.texts), [[0], [1]]);
  assert.ok(words[1].box.x0 > 4900);
});

test("the area to draw needs the canvas size, and reaches past the view by a margin", async () => {
  const { visibleArea } = await import("../src/viewport.js");
  // A view restored before the first layout has no size yet.
  assert.equal(visibleArea({ z: 1, x: 0, y: 0 }, null), null);
  assert.deepEqual(visibleArea({ z: 2, x: 10, y: 20 }, { width: 100, height: 40 }, 0.5), { x0: -30, y0: -20, x1: 70, y1: 20 });
});

test("a double click on a picked item opens the picks it was among; on another, that item alone", () => {
  // `before` is what was picked before the double click's first click changed it.
  assert.deepEqual(openWith([1, 2, 3], 2), [1, 2, 3]);
  assert.deepEqual(openWith([1, 2, 3], 7), [7]);
  assert.deepEqual(openWith([], 7), [7]);
});

test("a rectangle, rounded rectangle, stadium or circle is a box; anything else stays a path", async () => {
  const { quadOf } = await import("../src/quad.js");
  const { ellipse } = await import("../src/scene.js");
  const fill = (cmds, more = {}) => ({ kind: "fill", paint: "#a", cmds, ...more });
  assert.deepEqual(quadOf(fill(roundRect(10, 20, 30, 40, 5))), { x0: 10, y0: 20, x1: 40, y1: 60, r: 5 });
  assert.deepEqual(quadOf(fill(roundRect(10, 20, 30, 40))), { x0: 10, y0: 20, x1: 40, y1: 60, r: 0 });
  // A stadium as pele writes it: two half circles joined by lines.
  const stadium = [M, 10, 0, A, 10, 10, 0, 0, 0, 10, 20, L, 90, 20, A, 10, 10, 0, 0, 0, 90, 0, Z];
  assert.deepEqual(quadOf(fill(stadium)), { x0: 0, y0: 0, x1: 100, y1: 20, r: 10 });
  assert.deepEqual(quadOf(fill(ellipse(50, 50, 10, 10))), { x0: 40, y0: 40, x1: 60, y1: 60, r: 10 });
  // An outline is a box too, where its path runs: the renderer widens it by the stroke.
  assert.deepEqual(quadOf({ kind: "stroke", paint: "#a", width: 2, cmds: roundRect(0, 0, 10, 10, 2) }), { x0: 0, y0: 0, x1: 10, y1: 10, r: 2 });

  const paths = {
    diamond: [M, 5, 0, L, 10, 5, L, 5, 10, L, 0, 5, Z],
    ellipse: ellipse(50, 50, 20, 10),
    "corners bent inward": [M, 10, 0, A, 10, 10, 0, 0, 1, 10, 20, L, 90, 20, A, 10, 10, 0, 0, 1, 90, 0, Z],
    "a side twice": [M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10, Z, M, 0, 0, L, 10, 0],
    curve: [M, 0, 0, C, 5, 0, 10, 5, 10, 10, L, 0, 10, Z],
  };
  for (const [name, cmds] of Object.entries(paths)) assert.equal(quadOf(fill(cmds)), null, name);
  assert.equal(quadOf({ kind: "stroke", paint: "#a", width: 1, dash: [3, 3], cmds: roundRect(0, 0, 10, 10) }), null, "dashed");
  // Three sides: filled, the path closes itself and is a box; drawn, it is an open line.
  const threeSides = [M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10];
  assert.deepEqual(quadOf(fill(threeSides)), { x0: 0, y0: 0, x1: 10, y1: 10, r: 0 });
  assert.equal(quadOf({ kind: "stroke", paint: "#a", width: 1, cmds: threeSides }), null);
  assert.equal(quadOf({ kind: "stroke", paint: "#a", width: 1, cmds: roundRect(0, 0, 10, 10) }) !== null, true);
});

test("boxes are drawn apart from paths, in paint order, a fill and its outline as one", async () => {
  const { chunkSpatial } = await import("../src/batch.js");
  const rect = (kind, x, item, more = {}) => ({ kind, paint: kind === "fill" ? "#f" : "#s", opacity: 1, width: kind === "stroke" ? 2 : undefined, cmds: roundRect(x, 0, 20, 10, 3), box: { x0: x, y0: 0, x1: x + 20, y1: 10 }, item, ...more });
  const edge = { kind: "stroke", paint: "#e", opacity: 1, width: 1, cmds: [M, 0, 5, L, 60, 5], box: { x0: 0, y0: 5, x1: 60, y1: 5 }, item: 2 };
  const [piece] = chunkSpatial([rect("fill", 0, 0), rect("stroke", 0, 0), edge, rect("fill", 40, 1), rect("stroke", 40, 1)], []);
  // The edge crosses both nodes: the first node goes under it, the second over it.
  assert.deepEqual(piece.parts.map((p) => `${p.layer.kind}:${p.shapes.length}`), ["box:1", "stroke:1", "box:1"]);
  const box = piece.parts[0].shapes[0];
  assert.deepEqual(box.quad, { x0: 0, y0: 0, x1: 20, y1: 10, r: 3 });
  assert.deepEqual([box.fill, box.stroke], [{ paint: "#f", opacity: 1 }, { paint: "#s", opacity: 1, width: 2 }]);
  // Boxes that do not overlap anything later share one layer, a fill alone too.
  const [apart] = chunkSpatial([rect("fill", 0, 0), rect("fill", 100, 1), rect("stroke", 100, 1)], []);
  assert.deepEqual(apart.parts.map((p) => `${p.layer.kind}:${p.shapes.length}`), ["box:2"]);
  assert.equal(apart.parts[0].shapes[0].stroke, undefined);
});

test("a dash pattern too fine to see on screen is drawn as the line it looks like", async () => {
  const { screenDash } = await import("../src/paint.js");
  // At 100% a 3-on 4-off dash is 7 px a period: drawn as it is, scaled.
  assert.deepEqual(screenDash([3, 4], 1), { dash: [3, 4], alpha: 1 });
  assert.deepEqual(screenDash([3, 4], 0.5), { dash: [1.5, 2], alpha: 1 });
  // At 12% a period is under a pixel: a solid line as dark as the dashes average.
  assert.deepEqual(screenDash([3, 4], 0.12), { dash: null, alpha: 3 / 7 });
  assert.deepEqual(screenDash([2, 1, 1, 1], 0.1), { dash: null, alpha: 3 / 5 });
  assert.deepEqual(screenDash(null, 0.1), { dash: null, alpha: 1 });
});
