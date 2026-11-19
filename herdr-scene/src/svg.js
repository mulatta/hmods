// The fallback adapter: any SVG text -> scene. Used for engines that only
// write SVG. Covers g/svg/a, rect, circle, ellipse, line, polyline, polygon,
// path, text/tspan, translate() transforms and inherited presentation
// attributes; anything else is counted in scene.skipped.

import { SceneBuilder, L, M, ellipse, parsePath, polygon, roundRect, numbers } from "./scene.js";

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
const unescape = (s) =>
  s.indexOf("&") < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) =>
        e[0] === "#"
          ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
          : ENT[e] ?? all);

/** A minimal XML reader for well-formed generator output. */
export function parseXml(src) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ text: m[1] });
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(attrRe)) attrs[a[1]] = unescape(a[2] ?? a[3]);
      const el = { tag: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push({ text: unescape(m[6]) });
  }
  return root.children.find((c) => c.tag === "svg") ?? root;
}

const INHERITED = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-size", "font-weight", "font-style", "text-anchor", "fill-opacity", "stroke-opacity", "opacity"];
// Pele writes its corner radius as `style="rx:var(--_r)"`; --pele-radius defaults to 4px.
const RADIUS = { "var(--_r)": 4 };

const len = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

function own(el) {
  const out = { ...el.attrs };
  if (el.attrs.style) {
    for (const decl of el.attrs.style.split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

const weightOf = (v, fallback) => (v === undefined ? fallback : v === "bold" ? 700 : v === "normal" ? 400 : len(v, fallback));

/** SVG text -> scene. */
export function svgToScene(svgText) {
  const svg = parseXml(svgText);
  const vb = (svg.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, len(svg.attrs.width, 300), len(svg.attrs.height, 150)];
  const b = new SceneBuilder(vx, vy, vw, vh);
  const font = svg.attrs.style?.match(/font:\s*(\d+(?:\.\d+)?)px/);
  walk(svg, { fill: svg.attrs.fill ?? "var(--_fg)", "font-size": font ? font[1] : "16" }, 0, 0, b);
  return b.done();
}

function look(st) {
  const dash = st["stroke-dasharray"] && st["stroke-dasharray"] !== "none" ? numbers(st["stroke-dasharray"]) : null;
  return {
    fill: st.fill ?? null, stroke: st.stroke ?? null, width: len(st["stroke-width"], 1), dash,
    opacity: len(st.opacity, 1), fillOpacity: len(st["fill-opacity"], 1), strokeOpacity: len(st["stroke-opacity"], 1),
  };
}

// Where an element comes from, from the `data-` attributes pele writes with `sourceInfo`.
function sourceOf(attrs) {
  const out = {};
  if (attrs["data-line"] !== undefined) out.line = Number(attrs["data-line"]);
  if (attrs["data-end"] !== undefined) out.end = Number(attrs["data-end"]);
  for (const k of ["symbol", "from", "to"]) if (attrs[`data-${k}`] !== undefined) out[k] = attrs[`data-${k}`];
  return out;
}

function walk(el, inherited, dx, dy, b) {
  for (const c of el.children) {
    if (!c.tag) continue;
    const a = own(c);
    const st = { ...inherited };
    for (const k of INHERITED) if (a[k] !== undefined) st[k] = a[k];
    let tx = dx, ty = dy;
    if (c.attrs.transform) {
      const m = c.attrs.transform.match(/^\s*translate\(\s*([-\d.e+]+)(?:[\s,]+([-\d.e+]+))?\s*\)\s*$/);
      if (!m) {
        b.skip(`transform ${c.attrs.transform.replace(/[-\d.]+/g, "#")}`);
        continue;
      }
      tx += Number(m[1]);
      ty += Number(m[2] ?? 0);
    }
    const id = c.attrs["data-id"];
    const opened = id !== undefined && (c.tag === "g" || b.item < 0);
    if (opened) b.begin(id, c.attrs.class ?? c.tag, sourceOf(c.attrs));
    switch (c.tag) {
      case "g": case "a": case "svg":
        walk(c, st, tx, ty, b);
        break;
      case "rect": {
        const w = len(a.width, 0), h = len(a.height, 0);
        const rx = RADIUS[a.rx ?? a.ry] ?? len(a.rx ?? a.ry, 0), ry = RADIUS[a.ry ?? a.rx] ?? len(a.ry ?? a.rx, 0);
        if (w > 0 && h > 0) b.path(roundRect(len(a.x, 0) + tx, len(a.y, 0) + ty, w, h, rx, ry), look(st));
        break;
      }
      case "circle": {
        const r = len(a.r, 0);
        if (r > 0) b.path(ellipse(len(a.cx, 0) + tx, len(a.cy, 0) + ty, r, r), look(st));
        break;
      }
      case "ellipse": {
        const rx = len(a.rx, 0), ry = len(a.ry, 0);
        if (rx > 0 && ry > 0) b.path(ellipse(len(a.cx, 0) + tx, len(a.cy, 0) + ty, rx, ry), look(st));
        break;
      }
      case "line":
        b.path([M, len(a.x1, 0) + tx, len(a.y1, 0) + ty, L, len(a.x2, 0) + tx, len(a.y2, 0) + ty], { ...look(st), fill: null });
        break;
      case "polygon": case "polyline": {
        const cmds = polygon(numbers(a.points ?? ""), c.tag === "polygon", tx, ty);
        b.path(cmds, c.tag === "polyline" ? { ...look(st), fill: a.fill ?? null } : look(st));
        break;
      }
      case "path":
        if (a.d) b.path(parsePath(a.d, tx, ty), look(st));
        break;
      case "text":
        text(c, st, tx, ty, b);
        break;
      case "title": case "desc": case "defs": case "style":
        break;
      default:
        b.skip(c.tag);
    }
    if (opened) b.end();
  }
}

function text(el, st, tx, ty, b) {
  const size = len(st["font-size"], 16);
  const base = {
    size, weight: weightOf(st["font-weight"], 400), italic: st["font-style"] === "italic",
    anchor: st["text-anchor"] ?? "start", paint: st.fill ?? "var(--_fg)",
  };
  let x = len(el.attrs.x, 0) + tx, y = len(el.attrs.y, 0) + ty;
  let spans = [];
  let lx = x, ly = y;
  const flush = () => {
    if (spans.length) b.text(lx, ly, spans, base);
    spans = [];
  };
  const visit = (node, lk) => {
    for (const c of node.children) {
      if (!c.tag) {
        if (c.text) {
          if (!spans.length) { lx = x; ly = y; }
          spans.push({ text: c.text, weight: lk.weight, italic: lk.italic, paint: lk.paint });
        }
        continue;
      }
      if (c.tag !== "tspan") continue;
      const a = own(c);
      const next = {
        weight: weightOf(a["font-weight"], lk.weight),
        italic: a["font-style"] ? a["font-style"] === "italic" : lk.italic,
        paint: a.fill ?? lk.paint,
      };
      // A tspan with its own position starts a new line.
      if (a.x !== undefined || a.y !== undefined || a.dy !== undefined) {
        flush();
        if (a.x !== undefined) x = len(a.x, 0) + tx;
        if (a.y !== undefined) y = len(a.y, 0) + ty;
        if (a.dy !== undefined) y += String(a.dy).endsWith("em") ? parseFloat(a.dy) * size : len(a.dy, 0);
      }
      visit(c, next);
    }
  };
  visit(el, { weight: base.weight, italic: base.italic, paint: base.paint });
  flush();
}
