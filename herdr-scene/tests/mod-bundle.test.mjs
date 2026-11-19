// The bundle mermaid loads (scripts/build.sh): diagram types load when a
// text first needs them, so Herdr's script heap holds only the kinds in use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readdirSync } from "node:fs";

const stubs = new URL("../bench/stubs/", import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "gpui-kit" || spec === "gpui-base" || spec === "herdr") return { url: new URL(`${spec}.js`, stubs).href, shortCircuit: true };
    if (spec === "fs/promises") return next("node:fs/promises", ctx);
    return next(spec, ctx);
  },
});
const vendor = new URL("../mods/mermaid/vendor/", import.meta.url);
const mod = await import(new URL("herdr-scene.js", vendor).href);
const { mermaidScene: full } = await import("../src/mermaid.js");

test("the mod's bundle keeps each diagram type in a piece of its own", () => {
  assert.ok(readdirSync(new URL("chunks/", vendor)).length >= 30);
});

test("a diagram type is drawn once prepared, as the full bundle draws it", async () => {
  const src = "sequenceDiagram\n  A->>B: hi\n  B-->>A: bye\n";
  assert.throws(() => mod.mermaidScene(src));
  await mod.prepare(src);
  assert.deepEqual(mod.mermaidScene(src), full(src));
});

test("text no type claims prepares nothing and fails as it would anyway", async () => {
  await mod.prepare("not a diagram");
  assert.throws(() => mod.mermaidScene("not a diagram"), /No diagram type detected|diagram/i);
});
