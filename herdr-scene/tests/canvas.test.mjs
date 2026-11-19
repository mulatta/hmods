// SceneCanvas in a stand-in host (bench/stubs): which pieces it draws when.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stubs = new URL("../bench/stubs/", import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "gpui-kit" || spec === "gpui-base" || spec === "herdr") return { url: new URL(`${spec}.js`, stubs).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { SceneCanvas } = await import("../src/gpui.js");
const { THEME } = await import("../bench/theme.js");
const { mermaidScene } = await import("../src/mermaid.js");

// A cx whose tasks run at once, and whose views draw when told to, as Herdr's do.
function host() {
  const tasks = [];
  const views = [];
  const acx = {
    sleep: async () => {},
    new(C, props) {
      const v = new C();
      v.init(props);
      v.release = () => (v.released = true);
      views.push(v);
      return v;
    },
    notify(v) {
      if (v) v.render();
    },
  };
  const cx = { spawn: (f) => tasks.push(f(acx)), notify() {}, stop_propagation() {} };
  return { cx, views, settle: async () => { while (tasks.length) await tasks.shift(); } };
}

const src = "flowchart LR\n" + Array.from({ length: 40 }, (_, i) => `  n${i}[Node ${i}] --> n${i + 1}`).join("\n") + "\n";

test("zooming back to the zoom drawn just before draws nothing again", async () => {
  const { scene } = await mermaidScene(src);
  const c = new SceneCanvas({});
  const h = host();
  c.set(scene);
  c.size = { width: 800, height: 600 };
  let drawn = 0;
  const draw = c.drawChunk.bind(c);
  c.drawChunk = (...a) => (drawn++, draw(...a));
  const frame = async () => {
    c.element(THEME, h.cx);
    await h.settle();
    c.element(THEME, h.cx); // the pieces on screen are told to draw
    await h.settle();
  };

  await frame();
  assert.ok(drawn > 0, "the first view is drawn");
  c.zoomBy(1.25);
  drawn = 0;
  await frame();
  assert.ok(drawn > 0, "a new zoom is drawn");
  const zoomedViews = c.views;

  c.zoomBy(1 / 1.25);
  drawn = 0;
  await frame();
  assert.equal(drawn, 0, "the zoom before is shown as it was drawn");

  c.zoomBy(1.25);
  drawn = 0;
  await frame();
  assert.equal(drawn, 0, "and so is the one after it");
  assert.equal(c.views, zoomedViews);

  c.zoomBy(2);
  await frame();
  assert.ok(h.views.filter((v) => v.released).length > 0, "a third zoom gives up the oldest drawing");
  c.dispose();
});

test("texts draw level, upright as stacked letters, and leave out outline-only halos", () => {
  const canvas = new SceneCanvas({ id: "texts" });
  const line = (text, extra) => ({ x: 50, y: 50, size: 10, weight: 400, italic: false, anchor: "middle", paint: "var(--_fg)", spans: [{ text }], item: -1, ...extra });
  canvas.set({ version: 3, x: 0, y: 0, w: 100, h: 100, baseline: null, shapes: [], items: [], skipped: {}, texts: [
    line("level"),
    line("halo", { paint: "none", stroke: "var(--_bg)", strokeWidth: 3 }),
    line("up", { angle: -90 }),
  ] });
  const out = canvas.texts([0, 1, 2], 1, { _fg: "#000000" });
  assert.equal(out.length, 2);
  // The upright line is a column of its letters, read from the bottom.
  assert.deepEqual(out[1].kids.map((k) => k.kids[0]), ["p", "u"]);
});

test("runs draw underlined, and sub- and superscripts smaller and moved off the line", async () => {
  const { record } = await import("../bench/stubs/gpui-kit.js");
  const canvas = new SceneCanvas({ id: "runs" });
  canvas.set({ version: 5, x: 0, y: 0, w: 100, h: 100, baseline: null, shapes: [], items: [], skipped: {}, texts: [
    { x: 50, y: 50, size: 12, weight: 400, italic: false, anchor: "start", paint: "var(--_fg)", item: -1, spans: [
      { text: "H" },
      { text: "2", scale: 0.5, shift: 0.25 },
      { text: "x", underline: true },
      { text: "n", scale: 0.5, shift: -0.5 },
    ] },
    { x: 50, y: 80, size: 10, weight: 400, italic: false, anchor: "start", paint: "var(--_fg)", item: -1, spans: [{ text: "all", underline: true }] },
  ] });
  record(true);
  const [line, one] = canvas.texts([0, 1], 2, { _fg: "#000000" });
  record(false);
  const calls = (e, name) => (e.log ?? []).filter((c) => c[0] === name).map((c) => c.slice(1));
  const [h, sub, x, sup] = line.kids;
  assert.deepEqual([calls(h, "text_size"), calls(h, "underline")], [[], []]);
  // At zoom 2: half of 24px, moved a quarter of 24px down; or half of 24px up.
  assert.deepEqual([calls(sub, "text_size"), calls(sub, "top")], [[[12]], [[6]]]);
  assert.deepEqual(calls(x, "underline"), [[]]);
  assert.deepEqual([calls(sup, "text_size"), calls(sup, "top")], [[[12]], [[-12]]]);
  assert.deepEqual(calls(one, "underline"), [[]]);
});

test("weights, fonts and corners follow pele's variables as the host sets them", async () => {
  const { record } = await import("../bench/stubs/gpui-kit.js");
  const { paletteFromTheme } = await import("../src/paint.js");
  const { asBoxes } = await import("../src/quad.js");
  const { roundRect } = await import("../src/scene.js");
  const palette = paletteFromTheme({ background: "#ffffff", foreground: "#000000" }, {
    css: { "pele-title-weight": "500", "pele-bold-weight": "600", "pele-font": "Inter", "pele-radius": "10" },
  });
  const canvas = new SceneCanvas({ id: "vars" });
  const text = { x: 0, y: 20, size: 10, italic: false, anchor: "start", paint: "var(--_fg)", item: -1 };
  canvas.set({ version: 6, x: 0, y: 0, w: 100, h: 100, baseline: null, shapes: [], items: [], skipped: {}, texts: [
    { ...text, weight: 700, weightVar: "--_tw", spans: [{ text: "Title" }] },
    { ...text, weight: 400, spans: [{ text: "a " }, { text: "b", weight: 700, weightVar: "--_w" }, { text: "c", weight: 700 }] },
    { ...text, weight: 400, family: "Georgia", spans: [{ text: "serif" }] },
  ] });
  record(true);
  const [title, runs, serif] = canvas.texts([0, 1, 2], 1, palette);
  record(false);
  const calls = (e, name) => (e.log ?? []).filter((c) => c[0] === name).map((c) => c.slice(1));
  assert.deepEqual([calls(title, "font_weight"), calls(title, "font_family")], [[[500]], [["Inter"]]]);
  assert.deepEqual(runs.kids.map((k) => calls(k, "font_weight")), [[], [[600]], [[700]]]);
  assert.deepEqual(calls(serif, "font_family"), [["Georgia"]]);
  // A rectangle with pele's corners keeps the variable, for the host's radius, at its scale.
  const [box, big] = asBoxes([
    { kind: "fill", paint: "red", opacity: 1, cmds: roundRect(0, 0, 40, 30, 4), box: { x0: 0, y0: 0, x1: 40, y1: 30 }, item: -1, radius: "--_r" },
    { kind: "fill", paint: "red", opacity: 1, cmds: roundRect(0, 0, 80, 60, 8), box: { x0: 0, y0: 0, x1: 80, y1: 60 }, item: -1, radius: "--_r", radiusScale: 2 },
  ]);
  assert.equal(box.quad.radius, "--_r");
  record(true);
  const out = [];
  canvas.box(out, box, 1, palette, (x) => x, (y) => y);
  canvas.box(out, big, 1, palette, (x) => x, (y) => y);
  record(false);
  assert.deepEqual(out.map((e) => calls(e, "rounded")), [[[10]], [[20]]]);
});

test("a dashed rectangle with pele's corners is drawn with the radius set", async () => {
  const stub = await import("../bench/stubs/gpui-kit.js");
  const { paletteFromTheme } = await import("../src/paint.js");
  const { roundRect } = await import("../src/scene.js");
  const palette = paletteFromTheme({ background: "#ffffff", foreground: "#000000" }, { css: { "pele-radius": "10" } });
  const canvas = new SceneCanvas({ id: "dashed" });
  canvas.set({ version: 6, x: 0, y: 0, w: 100, h: 100, baseline: null, shapes: [], items: [], skipped: {}, texts: [] });
  const made = [];
  const stroke = stub.PathBuilder.stroke;
  stub.PathBuilder.stroke = (...a) => {
    const p = stroke(...a);
    made.push(p);
    return p;
  };
  stub.record(true);
  const shape = { kind: "stroke", paint: "var(--_b)", opacity: 1, width: 1, dash: [3, 3], cmds: roundRect(0, 0, 40, 30, 4), box: { x0: 0, y0: 0, x1: 40, y1: 30 }, item: -1, radius: "--_r" };
  canvas.paths([{ layer: { kind: "stroke", paint: "var(--_b)", opacity: 1, width: 1, dash: [3, 3] }, shapes: [shape] }], 1, palette);
  stub.record(false);
  stub.PathBuilder.stroke = stroke;
  const arcs = made[0].log.filter((c) => c[0] === "arc_to");
  assert.deepEqual(arcs.map((c) => [c[1], c[2]]), [[10, 10], [10, 10], [10, 10], [10, 10]]);
});

test("a box whose corners the radius set makes elliptical is drawn as a path", async () => {
  const stub = await import("../bench/stubs/gpui-kit.js");
  const { paletteFromTheme } = await import("../src/paint.js");
  const { asBoxes } = await import("../src/quad.js");
  const { roundRect } = await import("../src/scene.js");
  const palette = paletteFromTheme({ background: "#ffffff", foreground: "#000000" }, { css: { "pele-radius": "10" } });
  const canvas = new SceneCanvas({ id: "oval" });
  const shape = (kind) => ({ kind, paint: "#ff0000", opacity: 1, width: 2, cmds: roundRect(0, 0, 40, 12, 4), box: { x0: 0, y0: 0, x1: 40, y1: 12 }, item: -1, radius: "--_r" });
  const [box] = asBoxes([shape("fill"), shape("stroke")]);
  assert.ok(box.fill && box.stroke);
  const made = [];
  const wrap = (name) => {
    const f = stub.PathBuilder[name];
    stub.PathBuilder[name] = (...a) => {
      const p = f(...a);
      made.push([name, p]);
      return p;
    };
    return () => (stub.PathBuilder[name] = f);
  };
  const undo = [wrap("fill"), wrap("stroke")];
  stub.record(true);
  const out = [];
  canvas.box(out, box, 1, palette, (x) => x, (y) => y);
  stub.record(false);
  for (const u of undo) u();
  // 10 across, cut to 6 down: a fill and an outline, each with elliptical corners.
  assert.deepEqual(made.map(([name, p]) => [name, p.log.filter((c) => c[0] === "arc_to").map((c) => [c[1], c[2]])]), [
    ["fill", [[10, 6], [10, 6], [10, 6], [10, 6]]],
    ["stroke", [[10, 6], [10, 6], [10, 6], [10, 6]]],
  ]);
  assert.equal(out.length, 2);
});
