// The pele fork draws every diagram type straight into a scene. Whether a
// scene shows what pele's old SVG showed is pele's own test (its scene
// baseline); here, what a host relies on in every scene.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as pele from "../build/pele.js";
import { sceneSupported } from "../build/pele.js";
import { mermaidScene } from "../src/index.js";
import { mermaidScene as viaAdapter } from "../src/mermaid.js";
import { sceneWith } from "../src/mermaid-scene.js";
import corpus from "./fixtures/corpus.js";

test("every diagram type is drawn straight into a scene", () => {
  assert.ok(sceneSupported("flowchart LR\n A-->B\n"));
  assert.ok(sceneSupported("pie\n \"a\": 1\n"));
});

test("the mermaid adapter draws through pele's scene", () => {
  assert.equal(viaAdapter("flowchart LR\n A-->B\n").type, "flowchart");
  assert.ok(mermaidScene('pie\n "a": 1\n "b": 2\n').scene.shapes.length > 0);
  assert.throws(() => mermaidScene("not a diagram"), (e) => e.name === "PeleError");
});

// The whole corpus through the adapter the mod uses: what a host can rely on in every scene.
test("every corpus diagram is drawn straight into a well-formed scene", () => {
  const ROLES = new Set(["label", "connection", "container", "element"]);
  const finite = (...v) => v.every(Number.isFinite);
  let drawn = 0;
  for (const [type, sources] of Object.entries(corpus)) {
    for (const src of sources) {
      if (typeof src !== "string") continue; // reference data, not diagram text
      let r;
      try {
        r = sceneWith(pele, src);
      } catch (e) {
        // Text pele rejects, it rejects with its own error.
        assert.equal(e.name, "PeleError", `${type}: ${e.message}`);
        continue;
      }
      drawn++;
      const where = `${type} ${JSON.stringify(src.slice(0, 60))}`;
      const s = r.scene;
      assert.equal(s.version, pele.SCENE_VERSION, where);
      assert.equal(s.vars["--_fg"], "var(--pele-fg,#1f1f1f)", where);
      assert.ok(s.w > 0 && s.h > 0, where);
      for (const it of s.items) {
        assert.ok(ROLES.has(it.role), `${where} item ${it.id} role ${it.role}`);
        if (it.box) assert.ok(finite(it.box.x0, it.box.y0, it.box.x1, it.box.y1) && it.box.x0 <= it.box.x1, `${where} item ${it.id} box`);
      }
      for (const x of s.shapes) {
        assert.ok(x.cmds.length > 0 && x.cmds.every(Number.isFinite), `${where} shape cmds`);
        assert.ok(x.item < s.items.length, where);
        if (x.gradient) assert.ok(s.gradients?.[x.gradient], `${where} gradient ${x.gradient}`);
      }
      for (const t of s.texts) assert.ok(finite(t.x, t.y, t.size) && t.spans.length > 0 && t.item < s.items.length, `${where} text`);
    }
  }
  assert.ok(drawn > 500, `drew ${drawn}`);
});
