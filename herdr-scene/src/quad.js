// Shapes a renderer can draw as a box (a quad: background, border, one corner
// radius) instead of a path. A path is tessellated into triangles and
// rasterized again on every frame the host paints; a quad is not, so the
// rectangles, rounded rectangles, stadiums and circles that most diagrams are
// made of cost next to nothing once they are boxes.
//
// A path is a box when every piece of it lies on the outline of one
// axis-aligned rounded rectangle and together they go round it once: lines
// along its sides, arcs of its corner circles bulging outward.

import { A, L, M, Z } from "./scene.js";

const TAU = 2 * Math.PI;

/**
 * An arc's circle (SVG arc with rx = ry; rotation does not matter for a circle).
 * @returns {{ cx: number, cy: number, r: number, mid: { x: number, y: number }, sweep: number }}
 */
function arcGeometry(x1, y1, r, large, sweep, x2, y2) {
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return null;
  // A radius too small for the chord is scaled up, as SVG does.
  const rr = Math.max(r, Math.sqrt(d2));
  const k = Math.sqrt(Math.max(0, (rr * rr - d2) / d2)) * (large === sweep ? -1 : 1);
  const cx = (x1 + x2) / 2 + k * dy, cy = (y1 + y2) / 2 - k * dx;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let da = Math.atan2(y2 - cy, x2 - cx) - a1;
  if (sweep && da < 0) da += TAU;
  if (!sweep && da > 0) da -= TAU;
  const am = a1 + da / 2;
  return { cx, cy, r: rr, sweep: Math.abs(da), mid: { x: cx + rr * Math.cos(am), y: cy + rr * Math.sin(am) } };
}

/**
 * The box a fill or (undashed) stroke shape draws, in the units of its path,
 * or null when it is not one. A stroke's box is where its path runs; the
 * stroke reaches half its width either side.
 * @param {import("./scene.js").Shape} s
 * @returns {{ x0: number, y0: number, x1: number, y1: number, r: number } | null}
 */
export function quadOf(s) {
  if (s.dash?.length) return null;
  const cmds = s.cmds;
  if (cmds[0] !== M) return null;
  // Most shapes that are not boxes give themselves away at once: a curve, a
  // slanted side, an elliptical arc. Only the rest pay for the geometry below.
  let px = cmds[1], py = cmds[2], n = 1;
  for (let i = 3; i < cmds.length; n++) {
    const op = cmds[i];
    if (op === L) {
      const x = cmds[i + 1], y = cmds[i + 2];
      if (x !== px && y !== py) return null;
      px = x;
      py = y;
      i += 3;
    } else if (op === A) {
      if (cmds[i + 1] !== cmds[i + 2]) return null;
      px = cmds[i + 6];
      py = cmds[i + 7];
      i += 8;
    } else if (op === Z) i += 1;
    else return null;
  }
  if (n < 3) return null;
  return quick(cmds) ?? traced(s, cmds);
}

// Where each command of a rounded box starts in its path: M, then L and A in turn, then Z.
const ROUND = [0, 3, 6, 14, 17, 25, 28, 36, 39, 47, 48];

// The two outlines nearly every box is drawn with, checked by their points:
// four sides (roundRect without corners), and roundRect's sides and quarter
// circles. Anything else takes the general trace.
function quick(cmds) {
  const n = cmds.length;
  if (n === 13 && cmds[12] === Z && cmds[3] === L && cmds[6] === L && cmds[9] === L) {
    const ax = cmds[1], ay = cmds[2], bx = cmds[4], by = cmds[5], cx = cmds[7], cy = cmds[8], dx = cmds[10], dy = cmds[11];
    const across = ay === by && bx === cx && cy === dy && dx === ax, down = ax === bx && by === cy && cx === dx && dy === ay;
    if (!(across || down) || ax === cx || ay === cy) return null;
    return { x0: Math.min(ax, cx), y0: Math.min(ay, cy), x1: Math.max(ax, cx), y1: Math.max(ay, cy), r: 0 };
  }
  if (n !== 48 || cmds[47] !== Z) return null;
  for (let i = 1; i < 9; i++) if (cmds[ROUND[i]] !== (i % 2 ? L : A)) return null;
  const r = cmds[ROUND[2] + 1];
  for (const i of [2, 4, 6, 8]) {
    const a = ROUND[i];
    if (cmds[a + 1] !== r || cmds[a + 4] !== 0 || cmds[a + 5] !== 1) return null;
  }
  const x0 = cmds[ROUND[6] + 6], y0 = cmds[2], x1 = cmds[ROUND[2] + 6], y1 = cmds[ROUND[4] + 7];
  if (!(r > 0 && x1 - x0 >= 2 * r && y1 - y0 >= 2 * r)) return null;
  const eps = 1e-9 * Math.max(1, Math.abs(x1), Math.abs(y1));
  const at = (k, x, y) => Math.abs(cmds[ROUND[k + 1] - 2] - x) <= eps && Math.abs(cmds[ROUND[k + 1] - 1] - y) <= eps;
  const ok = at(0, x0 + r, y0) && at(1, x1 - r, y0) && at(2, x1, y0 + r) && at(3, x1, y1 - r)
    && at(4, x1 - r, y1) && at(5, x0 + r, y1) && at(6, x0, y1 - r) && at(7, x0, y0 + r) && at(8, x0 + r, y0);
  return ok ? { x0, y0, x1, y1, r } : null;
}

function traced(s, cmds) {
  const lines = [], arcs = [];
  let x = cmds[1], y = cmds[2];
  const sx = x, sy = y;
  let closed = false;
  for (let i = 3; i < cmds.length; ) {
    const op = cmds[i];
    if (closed) return null; // anything after the outline closes is more than one box
    if (op === L) {
      lines.push([x, y, cmds[i + 1], cmds[i + 2]]);
      x = cmds[i + 1];
      y = cmds[i + 2];
      i += 3;
    } else if (op === A) {
      const g = arcGeometry(x, y, cmds[i + 1], cmds[i + 4], cmds[i + 5], cmds[i + 6], cmds[i + 7]);
      if (!g) return null;
      arcs.push(g);
      x = cmds[i + 6];
      y = cmds[i + 7];
      i += 8;
    } else if (op === Z) {
      if (x !== sx || y !== sy) lines.push([x, y, sx, sy]);
      [x, y] = [sx, sy];
      closed = true;
      i += 1;
    } else return null;
  }
  // A stroke has to come back to where it began; a fill closes itself.
  if (!closed && (x !== sx || y !== sy)) {
    if (s.kind === "stroke") return null;
    lines.push([x, y, sx, sy]);
  }

  // The box is what its sides and corner circles reach.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const reach = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };
  for (const [ax, ay, bx, by] of lines) reach(ax, ay), reach(bx, by);
  const r = arcs.length ? arcs[0].r : 0;
  for (const a of arcs) {
    if (Math.abs(a.r - r) > 1e-6 * Math.max(1, r)) return null;
    reach(a.cx - r, a.cy - r);
    reach(a.cx + r, a.cy + r);
  }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0) || r > Math.min(w, h) / 2 + 1e-6) return null;
  const eps = 1e-6 * Math.max(1, w, h);
  const near = (a, b) => Math.abs(a - b) <= eps;

  // Lines run along the sides, between the corners.
  for (const [ax, ay, bx, by] of lines) {
    const flat = near(ay, by) && (near(ay, y0) || near(ay, y1)) && Math.min(ax, bx) >= x0 + r - eps && Math.max(ax, bx) <= x1 - r + eps;
    const upright = near(ax, bx) && (near(ax, x0) || near(ax, x1)) && Math.min(ay, by) >= y0 + r - eps && Math.max(ay, by) <= y1 - r + eps;
    if (!flat && !upright) return null;
  }
  // Arcs are corner circles, bulging away from the middle.
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (const a of arcs) {
    const cornerX = near(a.cx, x0 + r) || near(a.cx, x1 - r), cornerY = near(a.cy, y0 + r) || near(a.cy, y1 - r);
    if (!cornerX || !cornerY) return null;
    // Outward: the arc's middle lies past its circle's centre, away from the box's.
    const ox = (a.mid.x - a.cx) * (a.cx - mx || (a.mid.x - a.cx)), oy = (a.mid.y - a.cy) * (a.cy - my || (a.mid.y - a.cy));
    if (ox < -eps || oy < -eps) return null;
  }
  // Round once: the pieces add up to the outline's length, no side left out or drawn twice.
  let length = 0;
  for (const [ax, ay, bx, by] of lines) length += Math.hypot(bx - ax, by - ay);
  for (const a of arcs) length += a.sweep * a.r;
  const outline = 2 * (w - 2 * r) + 2 * (h - 2 * r) + TAU * r;
  if (Math.abs(length - outline) > 1e-4 * outline) return null;
  return { x0, y0, x1, y1, r };
}

const same = (a, b) => {
  const eps = 1e-6 * Math.max(1, a.x1 - a.x0, a.y1 - a.y0);
  return Math.abs(a.x0 - b.x0) <= eps && Math.abs(a.y0 - b.y0) <= eps && Math.abs(a.x1 - b.x1) <= eps && Math.abs(a.y1 - b.y1) <= eps && Math.abs(a.r - b.r) <= eps;
};

/**
 * Shapes with every box made a `box` shape: `quad`, and its `fill` and/or
 * `stroke` look. A fill followed at once by its own outline becomes one box,
 * which is how a node is drawn.
 * @param {import("./scene.js").Shape[]} shapes
 */
export function asBoxes(shapes) {
  const out = [];
  for (const s of shapes) {
    const quad = quadOf(s);
    if (!quad) {
      out.push(s);
      continue;
    }
    const look = s.kind === "fill" ? { paint: s.paint, opacity: s.opacity ?? 1 } : { paint: s.paint, opacity: s.opacity ?? 1, width: s.width ?? 1 };
    const last = out[out.length - 1];
    if (s.kind === "stroke" && last?.kind === "box" && last.fill && !last.stroke && last.item === s.item && same(last.quad, quad)) {
      last.stroke = look;
      last.box = s.box;
      continue;
    }
    // Corners by pele's radius variable are drawn by the value a host sets it to.
    if (s.radius) {
      quad.radius = s.radius;
      if (s.radiusScale) quad.radiusScale = s.radiusScale;
    }
    out.push({ kind: "box", quad, [s.kind]: look, box: s.box, item: s.item, cmds: s.cmds });
  }
  return out;
}

/**
 * A rectangle drawn with pele's corners (roundRect's outline, turned or
 * scaled), its corners rounded by `radius` instead: each corner stays where
 * its two sides meet, and the radius is drawn at `scale`, the scale pele
 * drew the rectangle at (its `radiusScale`). A radius past half a side is cut
 * to it; none squares the corners. Any other path is returned as it is.
 * @param {number[]} cmds
 * @param {number} radius
 * @param {number} [scale]
 */
export function cornered(cmds, radius, scale = 1) {
  if (cmds.length !== 48 || cmds[0] !== M || cmds[47] !== Z) return cmds;
  for (let i = 1; i < 9; i++) if (cmds[ROUND[i]] !== (i % 2 ? L : A)) return cmds;
  // pele cuts its corners to half of each side on its own: they may be elliptical.
  const rx0 = cmds[ROUND[2] + 1], ry0 = cmds[ROUND[2] + 2];
  if (!(rx0 > 0 && ry0 > 0)) return cmds;
  // The end of each command: p[0] the start, p[2k-1] where side k ends, p[2k] where its corner ends.
  const p = [[cmds[1], cmds[2]]];
  for (let i = 1; i < 9; i++) {
    const at = ROUND[i];
    p.push(cmds[at] === L ? [cmds[at + 1], cmds[at + 2]] : [cmds[at + 6], cmds[at + 7]]);
  }
  // Each side's direction from the corner arcs: the first two arcs' chords are the first side's
  // direction times rx0 plus and minus the second's times ry0, so a side cut to nothing still has one.
  const chord = (k) => [p[2 * k + 2][0] - p[2 * k + 1][0], p[2 * k + 2][1] - p[2 * k + 1][1]];
  const [v0, v1] = [chord(0), chord(1)];
  const d0 = [(v0[0] - v1[0]) / (2 * rx0), (v0[1] - v1[1]) / (2 * rx0)];
  const d1 = [(v0[0] + v1[0]) / (2 * ry0), (v0[1] + v1[1]) / (2 * ry0)];
  const dirs = [d0, d1, [-d0[0], -d0[1]], [-d1[0], -d1[1]]];
  // Where each side meets the next: its arc's start, on along the side by that arc's radius there.
  const along = (k) => (k % 2 ? ry0 : rx0);
  const corners = [0, 1, 2, 3].map((k) => [p[2 * k + 1][0] + dirs[k][0] * along(k), p[2 * k + 1][1] + dirs[k][1] * along(k)]);
  const side = (k) => Math.hypot(corners[k][0] - corners[(k + 3) % 4][0], corners[k][1] - corners[(k + 3) % 4][1]);
  // As pele cuts a radius: to half the width across, and half the height down.
  const rx = Math.max(0, Math.min(radius * scale, side(0) / 2));
  const ry = Math.max(0, Math.min(radius * scale, side(1) / 2));
  const out = [];
  let start = null;
  for (let k = 0; k < 4; k++) {
    const din = dirs[k], dout = dirs[(k + 1) % 4];
    const corner = corners[k];
    const rin = k % 2 ? ry : rx, rout = k % 2 ? rx : ry;
    const a = [corner[0] - din[0] * rin, corner[1] - din[1] * rin];
    const b = [corner[0] + dout[0] * rout, corner[1] + dout[1] * rout];
    out.push(L, a[0], a[1]);
    if (rx > 0 && ry > 0) out.push(A, rx, ry, cmds[ROUND[2 * k + 2] + 3], 0, cmds[ROUND[2 * k + 2] + 5], b[0], b[1]);
    else out.push(L, b[0], b[1]);
    if (k === 3) start = b;
  }
  return [M, start[0], start[1], ...out, Z];
}

