import assert from "node:assert/strict";
import test from "node:test";
import { cornered } from "../src/quad.js";
import { roundRect, A, L, M, Z } from "../src/scene.js";

const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// A turn by `deg` about the origin, of a path's points (and an arc's tilt).
function turned(cmds, deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const out = [];
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    if (op === A) {
      const [rx, ry, rot, large, sweep, x, y] = cmds.slice(i + 1, i + 8);
      out.push(A, rx, ry, rot + deg, large, sweep, c * x - s * y, s * x + c * y);
      i += 8;
    } else if (op === Z) {
      out.push(op);
      i += 1;
    } else {
      out.push(op, c * cmds[i + 1] - s * cmds[i + 2], s * cmds[i + 1] + c * cmds[i + 2]);
      i += 3;
    }
  }
  return out;
}

test("a rectangle with pele's corners is rounded again by the radius a host sets", () => {
  assert.ok(near(cornered(roundRect(0, 0, 40, 30, 4), 10), roundRect(0, 0, 40, 30, 10)));
  // Never past half a side, across or down, as pele cuts it; and square with none.
  assert.ok(near(cornered(roundRect(0, 0, 40, 12, 4), 10), roundRect(0, 0, 40, 12, 10)));
  // pele cut a small rectangle's corners on their own: they come back to the radius set.
  assert.ok(near(cornered(roundRect(0, 0, 20, 6, 4), 2), roundRect(0, 0, 20, 6, 2)));
  assert.deepEqual(cornered(roundRect(0, 0, 40, 30, 4), 0), [M, 0, 0, L, 40, 0, L, 40, 0, L, 40, 30, L, 40, 30, L, 0, 30, L, 0, 30, L, 0, 0, L, 0, 0, Z]);
});

test("turned or scaled, the corners keep their place on the rectangle", () => {
  assert.ok(near(cornered(turned(roundRect(0, 0, 40, 30, 4), 30), 10), turned(roundRect(0, 0, 40, 30, 10), 30)));
  // Drawn at twice the size, the radius set is twice as long too.
  assert.ok(near(cornered(roundRect(0, 0, 80, 60, 8), 10, 2), roundRect(0, 0, 80, 60, 20)));
  // A rectangle too small for pele's 4 was drawn with less; the scale still comes from pele.
  assert.ok(near(cornered(roundRect(0, 0, 12, 8, 4), 1, 2), roundRect(0, 0, 12, 8, 2)));
  // Anything else is left as it is.
  const path = [0, 0, 0, 1, 10, 0, 5];
  assert.equal(cornered(path, 10), path);
});
