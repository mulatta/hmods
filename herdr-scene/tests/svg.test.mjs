import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { svgToScene, parseXml } from "../src/index.js";

// SVG the pele fork wrote before it drew scenes only, for these sources:
//   flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]\n  B -.->|no| A
//   sequenceDiagram (User, Server: POST /login, 200 OK, a note over both)
const svg = (name) => readFileSync(new URL(`./fixtures/${name}.svg`, import.meta.url), "utf8");

const words = (scene) => scene.texts.flatMap((t) => t.spans.map((s) => s.text)).join(" ");

test("the XML reader keeps nesting, attributes and entities", () => {
  const svg = parseXml('<svg viewBox="0 0 1 1"><g data-id="a"><text x="1">a &amp; b<tspan x="2">c</tspan></text></g><rect/></svg>');
  assert.equal(svg.children.length, 2);
  assert.equal(svg.children[0].children[0].children[0].text, "a & b");
});

test("a flowchart keeps its nodes and edges as items, placed inside the view box", () => {
  const scene = svgToScene(svg("pele-flowchart"));
  assert.deepEqual(scene.skipped, {});
  const ids = new Set(scene.items.map((i) => i.id));
  for (const id of ["A", "B", "C"]) assert.ok(ids.has(id), id);
  assert.ok([...ids].some((id) => id.startsWith("L_B_C")));
  for (const w of ["Start", "Ok?", "Done", "yes", "no"]) assert.ok(words(scene).includes(w), w);
  for (const it of scene.items.filter((i) => i.kind.includes("pele-node"))) {
    assert.ok(it.box.x0 >= -1 && it.box.x1 <= scene.w + 1 && it.box.y0 >= -1 && it.box.y1 <= scene.h + 1, it.id);
  }
  assert.ok(scene.shapes.some((s) => s.kind === "stroke" && s.dash));
  // Paint stays a token, for the renderer's theme.
  assert.ok(scene.shapes.some((s) => s.paint.startsWith("var(")));
});

test("a sequence diagram keeps participants, messages and the note", () => {
  const scene = svgToScene(svg("pele-sequence"));
  assert.deepEqual(scene.skipped, {});
  for (const w of ["User", "Server", "POST /login", "200 OK", "session cookie set"]) assert.ok(words(scene).includes(w), w);
});
