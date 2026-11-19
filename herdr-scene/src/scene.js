// The scene contract: what an adapter (Mermaid, math, plain SVG) hands to a
// renderer. Plain data, so it can cross a process boundary as JSON and be
// cached. Version it: a renderer refuses a scene it does not understand.
//
// Coordinates are in the scene's own units (CSS px at 100%), y down.
//
// Paint is a string: "#rrggbb", "#rrggbbaa", "none", or a token the renderer
// resolves against its theme ("var(--_fg)", "var(--pele-bg,#fff)", ...).
// Keeping tokens unresolved lets one scene follow theme changes without being
// rebuilt.

export const SCENE_VERSION = 2;

/**
 * @typedef {number[]} Path
 *   One shape's outline as a flat array: an op code, then that op's arguments, command after
 *   command, in absolute coordinates. One array per path keeps a scene's heap and every walk
 *   over it to a few objects, where an array and a string per command were many.
 *     M x y (0)   L x y (1)   C x1 y1 x2 y2 x y (2)   Q x1 y1 x y (3)
 *     A rx ry rotation large sweep x y (4)   Z (5, no arguments)
 *   `large` and `sweep` are 0 or 1. Use the op constants, not the numbers.
 *
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box
 *
 * @typedef {object} Shape
 * @property {"fill"|"stroke"} kind
 * @property {string} paint
 * @property {number} [opacity]   0..1, multiplies the paint's alpha
 * @property {number} [width]     stroke width
 * @property {number[]|null} [dash]
 * @property {Path} cmds
 * @property {Box} box
 * @property {number} item        index into items, or -1
 * @property {string} [radius]     a rectangle, turned or not, whose corners this variable rounds (`--_r`; pele, version 6)
 * @property {number} [radiusScale] the scale that rectangle is drawn at, for its radius; absent, 1
 *
 * @typedef {object} Span
 * @property {string} text
 * @property {number} [weight]
 * @property {boolean} [italic]
 * @property {boolean} [mono]
 * @property {string} [paint]
 * @property {string} [weightVar]  the variable `weight` is the default of (pele, version 6)
 * @property {boolean} [underline]
 * @property {number} [scale]       a sub- or superscript's size, as a share of its text's
 * @property {number} [shift]       its baseline moved by that share of its text's size, down positive
 *
 * @typedef {object} Text           One line of text; spans run left to right.
 * @property {number} x
 * @property {number} y             baseline
 * @property {number} size
 * @property {number} weight
 * @property {boolean} italic
 * @property {"start"|"middle"|"end"} anchor
 * @property {string} paint
 * @property {Span[]} spans
 * @property {string} [weightVar]  the variable `weight` is the default of (pele, version 6)
 * @property {string} [family]     a family a style names, over the diagram's font
 * @property {number} item
 *
 * @typedef {object} Item           Something a person can point at: a node, an edge, a message.
 * @property {string} id
 * @property {string} kind          the adapter's class, e.g. "pele-node pele-shape-rect"
 * @property {Box|null} box
 * Where the author wrote it, when the adapter knows (Source):
 * @property {number} [line]        1-based line in the diagram's text, front matter included
 * @property {number} [end]         last line, for a block over several
 * @property {string} [symbol]      the name the author gave it
 * @property {string} [from]        a connection's ends, by name
 * @property {string} [to]
 *
 * @typedef {object} Scene
 * @property {number} version
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number|null} baseline  distance from the top to the text baseline, for inline math
 * @property {Shape[]} shapes        in paint order
 * @property {Text[]} texts          drawn above the shapes
 * @property {Item[]} items
 * @property {Record<string, string>} [vars]  what the CSS variables paints name stand for (pele, version 4); absent, pele's defaults
 * @property {Record<string, number>} skipped  what an adapter could not express, by name
 */

// Op codes of a Path, and how many arguments follow each.
export const M = 0, L = 1, C = 2, Q = 3, A = 4, Z = 5;
export const ARGC = [2, 2, 6, 4, 7, 0];

/** How many commands a path holds. */
export function cmdCount(cmds) {
  let n = 0;
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) n++;
  return n;
}

const grow = (b, x0, y0, x1, y1) => {
  if (x0 < b.x0) b.x0 = x0;
  if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1;
  if (y1 > b.y1) b.y1 = y1;
};

const emptyBox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

/** The bounding box of a path; control points over-approximate curves. */
export function cmdsBox(cmds) {
  const b = emptyBox();
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i], end = i + 1 + ARGC[op];
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) grow(b, cmds[k], cmds[k + 1], cmds[k], cmds[k + 1]);
    i = end;
  }
  return b;
}

/**
 * Builds a scene in paint order. Adapters call this rather than writing the
 * arrays themselves, so items get their boxes and every shape its box.
 */
export class SceneBuilder {
  constructor(x = 0, y = 0, w = 0, h = 0) {
    /** @type {Scene} */
    this.scene = { version: SCENE_VERSION, x, y, w, h, baseline: null, shapes: [], texts: [], items: [], skipped: {} };
    this.stack = [-1];
  }

  get item() {
    return this.stack[this.stack.length - 1];
  }

  /** Starts an item: everything added until `end()` belongs to it. `source`: where the author wrote it. */
  begin(id, kind, source = null) {
    this.scene.items.push({ id, kind, box: null, ...source });
    this.stack.push(this.scene.items.length - 1);
    return this.item;
  }

  end() {
    if (this.stack.length > 1) this.stack.pop();
  }

  touch(box) {
    const i = this.item;
    if (i < 0) return;
    const it = this.scene.items[i];
    if (!it.box) it.box = { ...box };
    else grow(it.box, box.x0, box.y0, box.x1, box.y1);
  }

  /** Adds a filled and/or stroked path. `fill`/`stroke` "none" or null skip that part. */
  path(cmds, { fill = null, stroke = null, width = 1, dash = null, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = {}) {
    if (!cmds.length) return;
    const box = cmdsBox(cmds);
    if (fill && fill !== "none") {
      this.scene.shapes.push({ kind: "fill", paint: fill, opacity: opacity * fillOpacity, cmds, box, item: this.item });
    }
    if (stroke && stroke !== "none" && width > 0) {
      const p = width / 2;
      this.scene.shapes.push({
        kind: "stroke", paint: stroke, opacity: opacity * strokeOpacity, width, dash: dash?.length ? dash : null, cmds,
        box: { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p }, item: this.item,
      });
    }
    this.touch(box);
  }

  /** Adds one line of text. `y` is the baseline. */
  text(x, y, spans, { size = 16, weight = 400, italic = false, anchor = "start", paint = "var(--_fg)" } = {}) {
    if (!spans.some((s) => s.text.trim())) return;
    this.scene.texts.push({ x, y, size, weight, italic, anchor, paint, spans, item: this.item });
    // An estimate: renderers measure for real, but hit boxes need something now.
    const w = spans.reduce((n, s) => n + s.text.length, 0) * size * 0.55;
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    this.touch({ x0, y0: y - size, x1: x0 + w, y1: y + size * 0.25 });
  }

  skip(what) {
    this.scene.skipped[what] = (this.scene.skipped[what] ?? 0) + 1;
  }

  done() {
    return this.scene;
  }
}

// ---------------------------------------------------------------- geometry

export const ellipse = (cx, cy, rx, ry) => [
  M, cx - rx, cy, A, rx, ry, 0, 0, 1, cx + rx, cy, A, rx, ry, 0, 0, 1, cx - rx, cy, Z,
];

export function roundRect(x, y, w, h, rx = 0, ry = rx) {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) return [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z];
  return [
    M, x + rx, y, L, x + w - rx, y, A, rx, ry, 0, 0, 1, x + w, y + ry,
    L, x + w, y + h - ry, A, rx, ry, 0, 0, 1, x + w - rx, y + h,
    L, x + rx, y + h, A, rx, ry, 0, 0, 1, x, y + h - ry,
    L, x, y + ry, A, rx, ry, 0, 0, 1, x + rx, y, Z,
  ];
}

export function polygon(points, close = true, dx = 0, dy = 0) {
  if (points.length < 4) return [];
  const cmds = [M, points[0] + dx, points[1] + dy];
  for (let i = 2; i + 1 < points.length; i += 2) cmds.push(L, points[i] + dx, points[i + 1] + dy);
  if (close) cmds.push(Z);
  return cmds;
}

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
export const numbers = (s) => (s.match(NUM) ?? []).map(Number);
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function arcNumbers(s) {
  const out = [];
  const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
  let m, i = 0;
  while ((m = re.exec(s))) {
    const k = i % 7;
    // Arc flags are single digits and may be packed: "011" is three numbers.
    if ((k === 3 || k === 4) && /^[01]{2,}/.test(m[0])) {
      re.lastIndex = m.index + 1;
      out.push(Number(m[0][0]));
    } else out.push(Number(m[0]));
    i++;
  }
  return out;
}

/** SVG path data -> absolute commands, shifted by (dx, dy). */
export function parsePath(d, dx = 0, dy = 0) {
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, cx = null, cy = null, qx = null, qy = null;
  for (const [, cmd, rest] of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const lc = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase();
    const v = lc === "a" ? arcNumbers(rest) : numbers(rest);
    const n = ARGS[lc];
    let first = true;
    do {
      const a = v.splice(0, n);
      if (a.length < n) break;
      const ox = rel ? x : 0, oy = rel ? y : 0;
      const kind = lc === "m" && !first ? "l" : lc;
      switch (kind) {
        case "m": x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; out.push(M, x + dx, y + dy); cx = qx = null; break;
        case "l": x = a[0] + ox; y = a[1] + oy; out.push(L, x + dx, y + dy); cx = qx = null; break;
        case "h": x = a[0] + ox; out.push(L, x + dx, y + dy); cx = qx = null; break;
        case "v": y = a[0] + oy; out.push(L, x + dx, y + dy); cx = qx = null; break;
        case "c": {
          const [x1, y1, x2, y2, ex, ey] = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
          out.push(C, x1 + dx, y1 + dy, x2 + dx, y2 + dy, ex + dx, ey + dy);
          cx = x2; cy = y2; x = ex; y = ey; qx = null; break;
        }
        case "s": {
          const x1 = cx === null ? x : 2 * x - cx, y1 = cy === null ? y : 2 * y - cy;
          const [x2, y2, ex, ey] = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
          out.push(C, x1 + dx, y1 + dy, x2 + dx, y2 + dy, ex + dx, ey + dy);
          cx = x2; cy = y2; x = ex; y = ey; qx = null; break;
        }
        case "q": {
          const [x1, y1, ex, ey] = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
          out.push(Q, x1 + dx, y1 + dy, ex + dx, ey + dy);
          qx = x1; qy = y1; x = ex; y = ey; cx = null; break;
        }
        case "t": {
          const x1 = qx === null ? x : 2 * x - qx, y1 = qy === null ? y : 2 * y - qy;
          const ex = a[0] + ox, ey = a[1] + oy;
          out.push(Q, x1 + dx, y1 + dy, ex + dx, ey + dy);
          qx = x1; qy = y1; x = ex; y = ey; cx = null; break;
        }
        case "a": {
          const ex = a[5] + ox, ey = a[6] + oy;
          out.push(A, Math.abs(a[0]), Math.abs(a[1]), a[2], a[3] ? 1 : 0, a[4] ? 1 : 0, ex + dx, ey + dy);
          x = ex; y = ey; cx = qx = null; break;
        }
        case "z": x = sx; y = sy; out.push(Z); cx = qx = null; break;
      }
      first = false;
    } while (n > 0 && v.length);
  }
  return out;
}
