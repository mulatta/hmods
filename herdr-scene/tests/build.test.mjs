import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("a Nix build diagnoses a mismatched esbuild before attempting a download", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hscene-esbuild-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Node supplies a real, different --version and fails on any npx invocation.
  for (const name of ["esbuild", "npx"]) symlinkSync(process.execPath, join(dir, name));
  const script = fileURLToPath(new URL("../scripts/build.sh", import.meta.url));
  const result = spawnSync("bash", [script, dir], {
    encoding: "utf8", env: { ...process.env, NIX_BUILD_TOP: dir, PATH: dir + ":" + process.env.PATH },
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`esbuild ${process.version} on PATH, `), result.stderr);
  assert.match(result.stderr, /\d+\.\d+\.\d+ pinned in build\.sh/);
});

test("the manual is readable from the checkout, build and package", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "hscene-manual-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../build/hscene.mjs", import.meta.url));
  const run = (args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  assert.match(run(["--help"]), /hscene --skill \[TOPIC\]/);
  const manual = new URL("../manual/", import.meta.url);
  const checkout = fileURLToPath(new URL("../cli/hscene.mjs", import.meta.url));
  const packaged = join(cwd, "lib/hscene");
  mkdirSync(packaged, { recursive: true });
  cpSync(cli, join(packaged, "hscene.mjs"));
  for (const dir of ["manual", "mods", "skills"]) {
    cpSync(new URL(`../${dir}`, import.meta.url), join(packaged, dir), { recursive: true });
  }
  for (const path of [checkout, cli, join(packaged, "hscene.mjs")]) {
    for (const topic of [undefined, "mermaid", "pele-css"]) {
      const args = topic ? ["--skill", topic] : ["--skill"];
      const expected = readFileSync(new URL(`${topic ?? "hscene"}.md`, manual), "utf8");
      assert.equal(execFileSync(process.execPath, [path, ...args], { cwd, encoding: "utf8" }), expected);
    }
  }
  const core = run(["--skill"]);
  assert.equal(core.split("\n")[0], "# hscene manual (herdr-scene)");
  for (const topic of ["mermaid", "pele-css"]) assert.ok(core.includes(`hscene --skill ${topic}`));
  assert.ok(!core.includes("hscene --skill hscene"));
  for (const args of [["unknown"], ["hscene"], ["../package"], ["mermaid", "pele-css"]]) {
    const result = spawnSync(process.execPath, [cli, "--skill", ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Topics: mermaid, pele-css$/m);
  }
});
