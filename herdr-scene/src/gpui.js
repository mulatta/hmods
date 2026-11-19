// Scene -> GPUI elements, for Herdr mods. Paths and text, items pickable with
// the pointer.
//
//   this.canvas = new SceneCanvas({ id: "my-canvas", onPick: (items, cx) => ..., onOpen: (item, cx) => ... });
//   this.canvas.set(scene);                 // when the source changes
//   ... render(cx) { return this.canvas.element(theme(), cx); }
//
// Scroll pans, Cmd/Ctrl+scroll zooms. A click picks an item (on nothing:
// none); Cmd or Shift adds to the picks and Option takes away. A drag pans,
// or with `selecting` on draws a box that picks what it touches, with the
// same keys. A double click on an item opens it with the picks it was among
// (onOpen(item, cx, items)), or alone. `badges` label
// items with short text, drawn at their top right.
//
// Herdr gives each render 50 ms, and drawing a path costs a host call per
// command on every render. So the drawing lives in retained child views, a
// share of the commands each (each render gets its own budget), drawn in px
// relative to the scene's corner: a pan only moves them, and draws the pieces
// it brings into view; a zoom or a palette change redraws what is in view
// once it settles. Pieces are grouped by where they are, so a zoomed-in view
// draws a fraction of a big diagram.

import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import { chunkSpatial } from "./batch.js";
import { cornered } from "./quad.js";
import { A, C, L, M, Q, Z } from "./scene.js";
import { fontOf, paletteFromTheme, radiusOf, resolvePaint, screenDash, weightOf, withAlpha } from "./paint.js";
import { hitTest, itemsInRect, openWith, pan, pickWith, readableFit, toScene, visibleArea, zoomAt } from "./viewport.js";

// Room around the scene inside the drawing, so strokes on its edge are not cut.
const PAD_PX = 8;
// A zoom redraws the scene this long after the last step, not on every step.
const SETTLE_MS = 60;
// Text this small (px) is hard to read: a fitted view zooms in to it at least.
const READABLE_PX = 9;
// Pieces this far (a share of the view) outside it are drawn already, so a
// pan rarely shows a gap.
const MARGIN = 0.25;

// "#rrggbb", or "#rrggbbff".
const opaque = (c) => /^#[0-9a-f]{6}(ff)?$/i.test(c);

// How a scene is cut into pieces (see chunkSpatial). Each piece is a child
// view the host renders, lays out and paints apart, and each of its layers a
// path: big pieces keep those few. Boxes cost little, so a piece can hold many.
const PIECES = { tile: 2400, cmds: 2000 };

const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

// The zoom at which the scene's usual text size reads as READABLE_PX.
function readableZoom(texts) {
  if (!texts.length) return 0;
  const sizes = texts.map((t) => t.size).sort((a, b) => a - b);
  return READABLE_PX / sizes[sizes.length >> 1];
}

const zoomOf = (s) => (Number(s?.zoom) > 0 ? Number(s.zoom) : 1);

// Child views find their canvas by handle: props carry plain data. Weakly,
// so a canvas whose view is gone (a closed pane) can be collected; its child
// views go with it.
const canvases = new Map();
const canvasOf = (handle) => {
  const c = canvases.get(handle)?.deref();
  if (!c) canvases.delete(handle);
  return c;
};
let nextCanvas = 0;

class ChunkView extends View {
  init(props) {
    this.p = props;
  }

  update(props) {
    this.p = props;
  }

  render() {
    return canvasOf(this.p.canvas)?.drawChunk(this.p.index, this.p.gen) ?? div();
  }
}

// A path's commands onto a builder, in piece coordinates. A fill closes each
// outline itself: the call is saved.
function trace(b, c, X, Y, z, fill) {
  for (let i = 0; i < c.length; ) {
    switch (c[i]) {
      case M: b = b.move_to(X(c[i + 1]), Y(c[i + 2])); i += 3; break;
      case L: b = b.line_to(X(c[i + 1]), Y(c[i + 2])); i += 3; break;
      case C: b = b.cubic_bezier_to(X(c[i + 5]), Y(c[i + 6]), X(c[i + 1]), Y(c[i + 2]), X(c[i + 3]), Y(c[i + 4])); i += 7; break;
      case Q: b = b.curve_to(X(c[i + 3]), Y(c[i + 4]), X(c[i + 1]), Y(c[i + 2])); i += 5; break;
      case A: b = b.arc_to(c[i + 1] * z, c[i + 2] * z, c[i + 3], !!c[i + 4], !!c[i + 5], X(c[i + 6]), Y(c[i + 7])); i += 8; break;
      case Z: if (!fill) b = b.close(); i += 1; break;
      default: i = c.length;
    }
  }
  return b;
}

export class SceneCanvas {
  constructor({ id = "scene-canvas", onPick = null, onOpen = null, onPress = null, padding = 24, maxZoom = 1.5 } = {}) {
    this.id = id;
    this.onPick = onPick;
    this.onOpen = onOpen;
    this.onPress = onPress; // any press on the canvas (to take the keyboard, say)
    this.padding = padding;
    this.maxZoom = maxZoom;
    this.scene = null;
    this.chunks = [];
    this.views = null; // ChunkView entities for `chunks`
    this.gen = 0; // which set of views is current: each zoom draws into a new one
    this.spare = null; // the drawing before the current one: { drawn, views, shown, asked, gen }
    this.inView = new Set(); // chunk indices on screen (with the margin)
    this.shown = []; // per chunk: the drawn key it shows, or null
    this.asked = []; // per chunk: the drawn key it was last told to draw
    this.minZ = 0;
    this.view = null; // null: fit
    this.size = null; // layout px
    this.zoom = 1; // Herdr's window zoom
    this.hover = -1;
    this.selecting = false; // drags draw a picking box instead of panning
    this.selected = []; // item indices, in the order picked
    this.drawn = null; // { key, z, palette } the child views draw
    this.wanted = null; // the key the current view needs
    this.handle = `c${nextCanvas++}`;
    for (const [h, ref] of canvases) if (!ref.deref()) canvases.delete(h);
    canvases.set(this.handle, new WeakRef(this));
    this.stats = { paths: 0, texts: 0, render: 0 };
  }

  /** Shows a new scene. `keepView` keeps the pan and zoom (a redraw of the same diagram). */
  set(scene, { keepView = false } = {}) {
    this.scene = scene;
    this.chunks = scene ? chunkSpatial(scene.shapes, scene.texts, PIECES) : [];
    this.shown = this.chunks.map(() => null);
    this.asked = this.chunks.map(() => null);
    this.inView = new Set();
    this.minZ = scene ? readableZoom(scene.texts) : 0;
    this.retire();
    this.drawn = this.wanted = null;
    if (!keepView) this.view = null;
    this.hover = -1;
    this.selected = [];
  }

  fit() {
    this.view = null;
  }

  /** The current zoom (scene units to layout px), or null before the first layout. */
  zoomLevel() {
    return this.currentView()?.z ?? null;
  }

  /** Zooms by `k` about the middle of the canvas. */
  zoomBy(k) {
    const v = this.currentView();
    if (v) this.view = zoomAt(v, k, { x: this.size.width / 2, y: this.size.height / 2 });
  }

  /** Zooms to `z` about the middle of the canvas. */
  zoomTo(z) {
    const v = this.currentView();
    if (v) this.zoomBy(z / v.z);
  }

  /** The picked items, in the order picked. */
  picked() {
    return this.selected.map((i) => this.scene.items[i]);
  }

  clearPicks() {
    this.selected = [];
  }

  /** Releases the child views; call when the canvas goes away for good. */
  dispose() {
    this.retire();
    canvases.delete(this.handle);
  }

  retire() {
    for (const e of this.views ?? []) e.release();
    for (const e of this.spare?.views ?? []) e.release();
    this.views = this.spare = null;
  }

  // The drawing in hand, to keep as the spare or to give up.
  held() {
    return { drawn: this.drawn, views: this.views, shown: this.shown, asked: this.asked, gen: this.gen };
  }

  hold(h) {
    ({ drawn: this.drawn, views: this.views, shown: this.shown, asked: this.asked, gen: this.gen } = h);
  }

  currentView() {
    if (this.view) return this.view;
    if (!this.scene || !this.size) return null;
    return readableFit(this.scene, this.size.width, this.size.height, this.padding, this.maxZoom, this.minZ);
  }

  item(i) {
    return i >= 0 ? this.scene?.items[i] ?? null : null;
  }

  local(e) {
    const r = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : null);
    return r ? { x: r.x / this.zoom, y: r.y / this.zoom } : null;
  }

  /** One chunk at the drawn zoom, in px within the drawing. Runs in a child view's render. */
  drawChunk(index, gen) {
    // A spare view is only ever shown as it last drew (Herdr keeps that); it draws nothing new.
    if (gen !== this.gen) return div();
    const c = this.chunks[index], d = this.drawn, s0 = this.scene;
    if (!c || !d || !s0 || !this.inView.has(index)) {
      this.shown[index] = null;
      return div();
    }
    this.shown[index] = d.key;
    const t0 = Date.now();
    const z = d.z, m = PAD_PX;
    const W = s0.w * z + 2 * m, H = s0.h * z + 2 * m;
    const els = c.parts ? this.paths(c.parts, z, d.palette) : this.texts(c.texts, z, d.palette);
    const ms = Date.now() - t0;
    if (c.parts) this.stats.paths = Math.max(this.stats.paths, ms);
    else this.stats.texts = Math.max(this.stats.texts, ms);
    return div().absolute().left(0).top(0).w(W).h(H).children(els);
  }

  paths(parts, z, palette) {
    const s0 = this.scene, m = PAD_PX;
    const X = (x) => (x - s0.x) * z + m, Y = (y) => (y - s0.y) * z + m;
    const out = [];
    for (const { layer, shapes } of parts) {
      if (layer.kind === "box") {
        for (const b of shapes) this.box(out, b, z, palette, X, Y);
        continue;
      }
      const { dash, alpha } = screenDash(layer.dash, z);
      const color = withAlpha(resolvePaint(layer.paint, palette), layer.opacity * alpha);
      if (!color) continue;
      const fill = layer.kind === "fill";
      let b = fill ? PathBuilder.fill() : PathBuilder.stroke(Math.max(0.5, (layer.width ?? 1) * z));
      if (dash) b = b.dash_array(dash);
      for (const s of shapes) {
        // A dashed or turned rectangle with pele's corners: rounded by the radius set here too.
        b = trace(b, s.radius ? cornered(s.cmds, radiusOf(palette, s.radius), s.radiusScale) : s.cmds, X, Y, z, fill);
      }
      // Placed at the piece's corner, where its coordinates start; it needs no box of its own.
      out.push(window.paint_path(b.build(), color).absolute().left(0).top(0));
    }
    return out;
  }

  // A box (quad.js) as an element: no path to tessellate or rasterize. An
  // outline sits where a stroke along the box's path would, half outside it,
  // as wide as paths() draws strokes; a fill under an opaque outline shares
  // its element, since the outline covers where the two differ.
  box(out, b, z, palette, X, Y) {
    const q = b.quad;
    const fill = b.fill ? withAlpha(resolvePaint(b.fill.paint, palette), b.fill.opacity) : null;
    const stroke = b.stroke ? withAlpha(resolvePaint(b.stroke.paint, palette), b.stroke.opacity) : null;
    const x = X(q.x0), y = Y(q.y0), w = (q.x1 - q.x0) * z, h = (q.y1 - q.y0) * z;
    let r = q.r * z;
    if (q.radius) {
      // pele cuts the radius set to half the width across and half the height down on their own;
      // a box rounds its corners by one radius, so corners that come out elliptical are a path.
      const set = radiusOf(palette, q.radius) * (q.radiusScale ?? 1);
      const rx = Math.min(set, (q.x1 - q.x0) / 2), ry = Math.min(set, (q.y1 - q.y0) / 2);
      if (rx !== ry) {
        const cmds = cornered(b.cmds, radiusOf(palette, q.radius), q.radiusScale);
        if (fill) out.push(window.paint_path(trace(PathBuilder.fill(), cmds, X, Y, z, true).build(), fill).absolute().left(0).top(0));
        if (stroke) {
          const pen = PathBuilder.stroke(Math.max(0.5, b.stroke.width * z));
          out.push(window.paint_path(trace(pen, cmds, X, Y, z, false).build(), stroke).absolute().left(0).top(0));
        }
        return;
      }
      r = rx * z;
    }
    const at = (d, rounded) => {
      let e = div().absolute().left(x - d).top(y - d).w(w + 2 * d).h(h + 2 * d);
      return rounded > 0 ? e.rounded(rounded) : e;
    };
    if (!stroke) {
      if (fill) out.push(at(0, r).bg(fill));
      return;
    }
    const bw = Math.max(0.5, b.stroke.width * z);
    const ring = (e) => e.border(bw).border_color(stroke);
    if (fill && opaque(stroke)) out.push(ring(at(bw / 2, r > 0 ? r + bw / 2 : 0).bg(fill)));
    else {
      if (fill) out.push(at(0, r).bg(fill));
      out.push(ring(at(bw / 2, r > 0 ? r + bw / 2 : 0)));
    }
  }

  // Every builder call crosses into the host: a line makes as few as it can,
  // one element for a plain line.
  texts(indices, z, palette) {
    const s0 = this.scene, m = PAD_PX;
    const out = [];
    const colors = new Map();
    const color = (p, fallback) => {
      if (!p) return fallback;
      let c = colors.get(p);
      if (c === undefined) colors.set(p, (c = resolvePaint(p, palette) ?? fallback));
      return c;
    };
    // Text is in pele's font variables: what pele.css names, else the host's fonts.
    const mono = fontOf(palette, "--_fm") ?? settings()?.font_family;
    const sans = fontOf(palette, "--_f");
    for (const i of indices) {
      const line = s0.texts[i];
      const size = line.size * z;
      if (size < 4) continue; // unreadable at this zoom
      // Letters with only an outline (a halo under other text): GPUI text has no outline.
      if (line.paint === "none") continue;
      const x = (line.x - s0.x) * z + m, y = (line.y - s0.y) * z + m;
      let chars = 0;
      for (const s of line.spans) chars += s.text.length;
      const base = color(line.paint, palette._fg);
      const lineWeight = line.weightVar ? weightOf(palette, line.weightVar, line.weight) : line.weight;
      const family = line.family ?? sans;
      // GPUI does not turn text: a line turned upright (an axis title) is stacked letter by
      // letter, centred where it would run; other angles are drawn level.
      const upright = line.angle !== undefined && Math.abs(Math.abs(line.angle) - 90) < 1;
      if (upright) {
        const text = line.spans.map((s) => s.text).join("");
        const tall = text.length * size;
        const top = line.anchor === "middle" ? y - tall / 2 : (line.angle < 0) === (line.anchor === "start") ? y - tall : y;
        let e = v_flex().absolute().left(x - size * 0.75).top(top).w(size).items_center()
          .text_size(size).line_height(`${size}px`).text_color(base);
        if (lineWeight !== 400) e = e.font_weight(lineWeight);
        if (family) e = e.font_family(family);
        const letters = line.angle < 0 ? [...text].reverse() : [...text];
        out.push(e.children(letters.map((c) => div().child(c === " " ? "\u00a0" : c))));
        continue;
      }
      const span = Math.max(40, chars * size * 0.7);
      const left = line.anchor === "middle" ? x - span / 2 : line.anchor === "end" ? x - span : x;
      const lh = size * 1.25;
      let e = h_flex().absolute().left(left).top(y - size * 0.95).w(span)
        // A bare number would be a multiple of the font size, not px.
        .text_size(size).line_height(`${lh}px`).whitespace_nowrap();
      if (family) e = e.font_family(family);
      if (line.anchor === "middle") e = e.justify_center();
      else if (line.anchor === "end") e = e.justify_end();
      // A run's own look over the line's: a script is set smaller and moved off the line by
      // shares of the line's size.
      const styled = (d, s) => {
        const w = s.weightVar ? weightOf(palette, s.weightVar, s.weight) : s.weight ?? lineWeight;
        if (w !== 400) d = d.font_weight(w);
        if (s.italic ?? line.italic) d = d.italic();
        if (s.mono && mono) d = d.font_family(mono);
        if (s.underline) d = d.underline();
        if (s.scale !== undefined) d = d.text_size(size * s.scale);
        if (s.shift) d = d.relative().top(size * s.shift);
        return d;
      };
      const one = line.spans.length === 1 && line.spans[0].shift === undefined ? line.spans[0] : null;
      if (one) {
        out.push(styled(e.text_color(color(one.paint, base)), one).child(one.text.replace(/ /g, " ")));
        continue;
      }
      out.push(e.text_color(base).children(line.spans.map((s) => {
        let d = div();
        if (s.paint) d = d.text_color(color(s.paint, base));
        return styled(d, s).child(s.text.replace(/ /g, " "));
      })));
    }
    return out;
  }

  // A piece worth a view in the tree: on screen, or holding a drawing to clear.
  live(i) {
    return this.inView.has(i) || this.shown[i] != null;
  }

  // Which pieces are on screen; those newly there and not yet drawn at the
  // drawn key are told to draw.
  look(cx, v) {
    const area = visibleArea(v, this.size, MARGIN);
    if (!area) return; // no size yet: drawn once it is known
    const fresh = [];
    this.inView = new Set();
    this.chunks.forEach((c, i) => {
      if (!c.box || !overlaps(c.box, area)) return;
      this.inView.add(i);
      // Asked once per drawn key: render runs often before the task does.
      if (this.drawn && this.shown[i] !== this.drawn.key && this.asked[i] !== this.drawn.key) fresh.push(i);
    });
    if (!fresh.length || !this.views) return;
    const views = this.views;
    for (const i of fresh) this.asked[i] = this.drawn.key;
    cx.spawn(async (acx) => {
      await acx.sleep(0); // still inside render until the first await
      if (this.views !== views) return;
      for (const i of fresh) if (this.shown[i] !== this.drawn?.key) acx.notify(views[i]);
    });
  }

  // Child views can only be made and told to redraw outside render, so render
  // asks a task to. The first drawing comes at once; a new zoom waits until
  // the zooming stops, and the old drawing stands in until then.
  //
  // Each zoom draws into views of its own, and the drawing before it is kept:
  // Herdr shows a view as it last drew without running its script, so going
  // back to that zoom (a zoom in and out again) costs no drawing at all.
  refresh(cx, key, z, palette) {
    if (this.wanted === key) return;
    const first = !this.drawn;
    this.wanted = key;
    if (this.spare?.drawn.key === key) {
      const now = this.held();
      this.hold(this.spare);
      this.spare = now;
      return;
    }
    const scene = this.scene;
    cx.spawn(async (acx) => {
      // The body runs synchronously up to its first await, still inside render.
      await acx.sleep(first ? 0 : SETTLE_MS);
      if (this.wanted !== key || this.scene !== scene) return;
      if (this.views) {
        for (const e of this.spare?.views ?? []) e.release();
        this.spare = this.held();
      }
      this.drawn = { key, z, palette };
      this.stats.paths = this.stats.texts = 0;
      this.shown = this.chunks.map(() => null);
      this.asked = this.chunks.map(() => null);
      const gen = ++this.gen;
      this.views = this.chunks.map((_, index) => acx.new(ChunkView, { canvas: this.handle, index, gen }));
      acx.notify();
    });
  }

  /**
   * The canvas element: fills its parent, draws the scene, handles the pointer.
   * `css` is pele CSS variables over the theme's (see peleCss).
   */
  element(theme, cx, { background = theme.background, badges = [], css = {} } = {}) {
    const t0 = Date.now();
    this.zoom = zoomOf(settings());
    const palette = paletteFromTheme(theme, { vars: this.scene?.vars, css });
    const el = div().id(this.id).size_full().min_h(0).relative().overflow_hidden().bg(background)
      .on_size_change((s, cx) => {
        const w = s.width / this.zoom, h = s.height / this.zoom;
        if (this.size && Math.abs(this.size.width - w) < 0.5 && Math.abs(this.size.height - h) < 0.5) return;
        this.size = { width: w, height: h };
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        const v = this.currentView();
        if (!v) return;
        const p = this.local(e) ?? { x: this.size.width / 2, y: this.size.height / 2 };
        this.view = e.modifiers.control || e.modifiers.platform
          ? zoomAt(v, Math.exp(-e.delta.y * 0.003), p)
          : pan(v, e.delta.x / this.zoom, e.delta.y / this.zoom);
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        // A press here pans or picks; it must not also move a window the canvas is in.
        cx.stop_propagation();
        this.onPress?.(cx);
        const v = this.currentView();
        const m = e.modifiers;
        if (v) this.drag = { x: e.position.x, y: e.position.y, v: { ...v }, moved: false, at: this.local(e), to: null, box: this.selecting, mods: { ...m } };
      })
      .on_mouse_move((e, cx) => {
        const g = this.drag;
        if (g) {
          const dx = (e.position.x - g.x) / this.zoom, dy = (e.position.y - g.y) / this.zoom;
          if (!g.moved && Math.hypot(dx, dy) < 3) return;
          g.moved = true;
          if (g.box) g.to = this.local(e) ?? g.to;
          else this.view = pan(g.v, dx, dy);
          cx.notify();
          return;
        }
        const v = this.currentView(), p = this.local(e);
        if (!v || !p || !this.scene) return;
        const h = hitTest(this.scene, v, p);
        if (h !== this.hover) {
          this.hover = h;
          cx.notify();
        }
      })
      .on_mouse_up("left", (e, cx) => {
        const g = this.drag;
        this.drag = null;
        const v = this.currentView();
        if (g && this.scene && v && (!g.moved || (g.box && g.at && g.to))) {
          let hits;
          if (g.moved) {
            const a = toScene(v, g.at), b = toScene(v, this.local(e) ?? g.to);
            hits = itemsInRect(this.scene, { x0: a.x, y0: a.y, x1: b.x, y1: b.y });
          } else {
            const p = this.local(e) ?? g.at, h = p ? hitTest(this.scene, v, p) : -1;
            hits = h >= 0 ? [h] : [];
            if (h >= 0 && e.click_count >= 2 && this.onOpen) {
              this.selected = openWith(this.beforeClick ?? [], h);
              this.onPick?.(this.picked(), cx);
              this.onOpen(this.item(h), cx, this.picked());
              cx.notify();
              return;
            }
            // The first click of a double click picks only what it hits; the second wants what was picked before.
            this.beforeClick = this.selected;
          }
          this.selected = pickWith(this.selected, hits, g.moved ? g.mods : e.modifiers);
          this.onPick?.(this.picked(), cx);
        }
        cx.notify();
      })
      .on_hover((h, cx) => {
        if (!h && (this.drag || this.hover >= 0)) {
          this.drag = null;
          this.hover = -1;
          cx.notify();
        }
      });
    const v = this.currentView();
    if (!this.scene || !v) return el;
    this.refresh(cx, `${v.z}|${Object.entries(palette).join("|")}`, v.z, palette);
    this.look(cx, v);
    const els = [];
    const d = this.drawn;
    if (this.views && d) {
      // Until a new zoom is drawn, the old drawing stays where the scene's corner now is.
      // Empty pieces off screen are left out: each one in the tree is a view the host renders.
      els.push(div().absolute().left(v.x + this.scene.x * v.z - PAD_PX).top(v.y + this.scene.y * v.z - PAD_PX)
        .w(this.scene.w * d.z + 2 * PAD_PX).h(this.scene.h * d.z + 2 * PAD_PX).children(this.views.filter((_, i) => this.live(i))));
    }
    const g = this.drag;
    if (g?.box && g.moved && g.at && g.to) {
      const x0 = Math.min(g.at.x, g.to.x), y0 = Math.min(g.at.y, g.to.y);
      const take = g.mods.alt;
      els.push(div().absolute().left(x0).top(y0).w(Math.abs(g.to.x - g.at.x)).h(Math.abs(g.to.y - g.at.y))
        .border_1().border_color(take ? theme.blocked : theme.accent).bg(withAlpha(take ? theme.blocked : theme.accent, 0.12)));
    }
    const marks = [[this.hover, withAlpha(theme.accent, 0.5)], ...this.selected.map((i) => [i, theme.accent])];
    for (const [i, color] of marks) {
      const b = this.item(i)?.box;
      if (!b) continue;
      const m = 4;
      els.push(div().absolute().left(b.x0 * v.z + v.x - m).top(b.y0 * v.z + v.y - m)
        .w((b.x1 - b.x0) * v.z + m * 2).h((b.y1 - b.y0) * v.z + m * 2)
        .rounded(6).border_2().border_color(color));
    }
    // Labels: { item, text }, at the item's top right edge.
    for (const { item, text } of badges) {
      const b = this.item(item)?.box;
      if (!b) continue;
      const short = text.length > 28 ? `${text.slice(0, 27)}…` : text;
      els.push(div().absolute().left(b.x1 * v.z + v.x - 6).top(b.y0 * v.z + v.y - 14).max_w(220)
        .px(6).py(1).rounded(8).bg(theme.accent).text_color(theme.accent_foreground).text_size(11).whitespace_nowrap()
        .child(short));
    }
    this.stats.render = Date.now() - t0;
    return el.children(els);
  }
}
