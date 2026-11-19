// Scene <-> screen: fitting, zooming around a point, and hit testing. Pure,
// so it is tested under Node; the GPUI renderer only applies the numbers.

/** @typedef {{ x: number, y: number, z: number }} View  screen = scene * z + (x, y) */

/** The view that shows the whole scene centered, never above `maxZoom`. */
export function fit(scene, width, height, pad = 24, maxZoom = 1.5) {
  const z = Math.max(0.05, Math.min((width - pad * 2) / scene.w, (height - pad * 2) / scene.h, maxZoom));
  return { z, x: (width - scene.w * z) / 2 - scene.x * z, y: (height - scene.h * z) / 2 - scene.y * z };
}

/** Zooms by `k` keeping the screen point `p` fixed. */
export function zoomAt(v, k, p, min = 0.05, max = 8) {
  const z = Math.max(min, Math.min(max, v.z * k));
  const f = z / v.z;
  return { z, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f };
}

export const pan = (v, dx, dy) => ({ ...v, x: v.x + dx, y: v.y + dy });

export const toScene = (v, p) => ({ x: (p.x - v.x) / v.z, y: (p.y - v.y) / v.z });

/**
 * The item under a screen point: the smallest box that holds it, with a few
 * px of slack so thin edges can be picked. Returns its index or -1.
 */
export function hitTest(scene, v, p, slack = 4) {
  const q = toScene(v, p);
  const s = slack / v.z;
  let best = -1, area = Infinity;
  scene.items.forEach((it, i) => {
    const b = it.box;
    if (!b || q.x < b.x0 - s || q.x > b.x1 + s || q.y < b.y0 - s || q.y > b.y1 + s) return;
    const a = (b.x1 - b.x0 + 2 * s) * (b.y1 - b.y0 + 2 * s);
    if (a < area) { best = i; area = a; }
  });
  return best;
}

// Links and groups span the nodes they join or hold: a box picks them only
// when it holds them whole, or every box across a diagram would. A sequence
// diagram's blocks (a loop, alt, a rect) hold its messages the same way.
// Picked by a box only when wholly inside it: lines and containers, which a box crosses on the way
// to what it means. Pele's items say what they are; others are told by their class names.
const wholeOnly = (it) =>
  it.role && it.role !== "label"
    ? it.role === "connection" || it.role === "container" || /lifeline/.test(it.kind ?? "")
    : /edge|cluster|lifeline|pele-frame|(^|\s)pele-rect(\s|$)/.test(it.kind ?? "");

/** Indices of the items a scene-space box (corners in any order) picks. */
export function itemsInRect(scene, r) {
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  const out = [];
  scene.items.forEach((it, i) => {
    const b = it.box;
    if (!b) return;
    const hit = wholeOnly(it)
      ? b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1
      : b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0;
    if (hit) out.push(i);
  });
  return out;
}

/**
 * The picks after picking `hits` with these modifier keys: none replaces,
 * Cmd or Shift adds, Option (Alt) takes away. Keeps pick order.
 */
export function pickWith(picked, hits, mods) {
  if (mods.alt) return picked.filter((i) => !hits.includes(i));
  if (mods.platform || mods.shift) return [...picked, ...hits.filter((i) => !picked.includes(i))];
  return [...hits];
}

/** What a double click on item `hit` opens: the picks from before it, if `hit` was among them, else `hit` alone. */
export const openWith = (before, hit) => (before.includes(hit) ? [...before] : [hit]);

/**
 * Like `fit`, but a scene too big to read whole (zoom below `minZ`) is shown
 * at a readable zoom instead, never more than fills its short side: the
 * overflowing axis starts at its beginning, the other is centered.
 */
export function readableFit(scene, width, height, pad = 24, maxZoom = 1.5, minZ = 0) {
  const zw = (width - pad * 2) / scene.w, zh = (height - pad * 2) / scene.h;
  const whole = fit(scene, width, height, pad, maxZoom);
  if (!(whole.z < minZ)) return whole;
  const z = Math.max(0.05, Math.min(maxZoom, Math.max(zw, zh), Math.max(minZ, whole.z)));
  const place = (size, room, at) => (size * z <= room - pad * 2 ? (room - size * z) / 2 - at * z : pad - at * z);
  return { z, x: place(scene.w, width, scene.x), y: place(scene.h, height, scene.y) };
}

/**
 * The scene area worth drawing for view `v` on a canvas of `size` (layout
 * px): what shows, plus `margin` (a share of each side) around it. Null
 * before the canvas has a size, which a view restored from a session can
 * come before.
 */
export function visibleArea(v, size, margin = 0.25) {
  if (!v || !size) return null;
  const mx = size.width * margin, my = size.height * margin;
  return { x0: (-mx - v.x) / v.z, y0: (-my - v.y) / v.z, x1: (size.width + mx - v.x) / v.z, y1: (size.height + my - v.y) / v.z };
}
