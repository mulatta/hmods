import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };

const cli = fileURLToPath(new URL("../build/hscene.mjs", import.meta.url));
const doc = "# Start\n\n```mermaid\nflowchart LR\n  A[One]\n  A --> B\n  C --> A\n  B --> D\n```\n";
function fixture(t, environment = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "hscene-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const home = join(cwd, "app"), state = join(cwd, "state");
  mkdirSync(home);
  function invoke(args, env = {}) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd, encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: home, XDG_STATE_HOME: state, ...environment, ...env },
    });
  }
  function run(args, status = 0) {
    const p = invoke(args);
    assert.equal(p.status, status, p.stdout + p.stderr);
    return p.stdout.trimEnd();
  }
  return { cwd, home, state, run, invoke };
}

test("check maps parse and CSS problems to source files and Markdown lines", (t) => {
  const { cwd, home, run } = fixture(t);
  writeFileSync(join(cwd, "flow.md"), doc + "\n```mermaid\nflowchart TD\n  A -->\n```\n");
  writeFileSync(join(home, "pele.css"), ":root { --brand: tomato; --pele-bg: var(--pele-fg); }");
  writeFileSync(join(cwd, "flow.pele.css"), "/* skip\ncomment */\n:root { --pele-new: red; --pele-fg: var(--brand); }\n@media (prefers-color-scheme: dark) { :root {\n  --pele-radius: heavy; } }");
  const result = JSON.parse(run(["check", "flow.md", "--json"], 1));
  assert.equal(result.diagrams, 2);
  const parse = result.problems.find((p) => p.kind === "parse");
  assert.deepEqual([parse.file, parse.line, parse.type, parse.diagram], ["flow.md", 13, "flowchart", "flow #2"]);
  assert.match(parse.message, /error/i);
  const css = result.problems.filter((p) => p.kind === "css");
  assert.ok(css.some((p) => p.file === "flow.pele.css" && p.line === 3 && /unknown.*--pele-new/i.test(p.message)));
  assert.ok(css.some((p) => p.line === 5 && p.message.includes("--pele-radius")));
  assert.ok(css.every((p) => !/--pele-(?:fg|bg)/.test(p.message)));
  assert.match(run(["check", "flow.md"], 1), /flow.md:13: flowchart: .*\n[\s\S]*2 diagrams in 1 files?, \d+ problems?$/);
});

test("check defaults to git-tracked diagrams under the current folder", (t) => {
  const { cwd, run } = fixture(t);
  execFileSync("git", ["init", "-q"], { cwd });
  writeFileSync(join(cwd, "tracked file.markdown"), doc);
  execFileSync("git", ["add", "."], { cwd });
  writeFileSync(join(cwd, "untracked.mmd"), "bad");
  assert.deepEqual(JSON.parse(run(["check", "--json"])), { diagrams: 1, problems: [] });
  assert.equal(JSON.parse(run(["check", ".", "--json"], 1)).diagrams, 2);
  run(["parts", "--near"], 2);
  run(["install", "--json"], 2);
  run(["parts", "missing.mmd"], 1);
});

test("parts uses Ask descriptions and returns only matching definitions and connections", (t) => {
  const { cwd, run } = fixture(t);
  writeFileSync(join(cwd, "flow.md"), doc);
  const [d] = JSON.parse(run(["parts", "--json", "flow.md"]));
  assert.deepEqual([d.file, d.diagram, d.lines], ["flow.md", "flow", [4, 8]]);
  const a = d.parts.find((p) => p.symbol === "A");
  assert.equal(a.quote, "A[One]");
  assert.equal(a.line, 5);
  assert.equal(a.text, 'element A "One" (line 5): A[One]');
  assert.deepEqual(Object.keys(a).sort(), ["role", "symbol", "from", "to", "label", "line", "end", "quote", "text"].sort());
  assert.ok(run(["parts", "flow.md"]).split("\n").includes(a.text));
  assert.equal(run(["parts", "flow.md", "--near", "A"]), "flow (lines 4-8)\n5:   A[One]\n6:   A --> B\n7:   C --> A");
  const near = JSON.parse(run(["parts", "flow.md", "--near", "A,D", "--json"]))[0];
  assert.deepEqual(near.lines.map((x) => x.line), [5, 6, 7, 8]);
  assert.equal("parts" in near, false);
});

test("install syncs in place, preserves Herdr files and reports the installed versions", (t) => {
  const { cwd, home, run } = fixture(t, { PATH: "" });
  const mod = join(home, "mods/mermaid"), skills = join(cwd, "skills"), skill = join(skills, "herdr-scene");
  run(["install", "--skill", skills, "--dry-run"]);
  assert.ok(!existsSync(mod) && !existsSync(skill));
  run(["install", "--skill", skills]);
  const mark = join(mod, ".hmods"), main = join(mod, "main.js");
  assert.deepEqual(JSON.parse(readFileSync(mark)), { tool: "hscene", version: manifest.version, check: "skipped" });
  assert.ok(statSync(main).mode & 0o200);
  assert.ok(lstatSync(join(mod, "vendor/herdr-scene.js")).isFile());
  const before = statSync(main, { bigint: true });
  const inode = statSync(mod).ino;
  const generated = join(mod, "gpui-kit.d.ts");
  if (!existsSync(generated)) writeFileSync(generated, "generated");
  const kept = readFileSync(generated, "utf8");
  writeFileSync(join(mod, "obsolete.js"), "obsolete");
  chmodSync(main, 0o444);
  run(["install", "--skill", skills]);
  assert.equal(statSync(mod).ino, inode);
  assert.equal(statSync(main, { bigint: true }).mtimeNs, before.mtimeNs);
  assert.ok(statSync(main).mode & 0o200);
  assert.equal(existsSync(join(mod, "obsolete.js")), false);
  assert.equal(readFileSync(generated, "utf8"), kept);
  assert.equal(existsSync(join(cwd, "state/hmods/backups")), false);
  assert.deepEqual(JSON.parse(run(["status", "--json"])), {
    mods: { mermaid: { installed: manifest.version, check: "skipped", package: manifest.version, path: mod } },
    skills: [{ path: skill, installed: manifest.version, package: manifest.version }],
  });
  writeFileSync(mark, '{"tool":"hscene","version":"0.0.0","check":"passed"}');
  assert.match(run(["status"]), /outdated/);
  run(["uninstall", "--dry-run"]);
  assert.ok(existsSync(mod));
  run(["uninstall"]);
  assert.ok(!existsSync(mod) && !existsSync(skill));
});

test("foreign folders are backed up and top-level links leave their referents alone", (t) => {
  const { cwd, run, state } = fixture(t);
  const home = join(cwd, "other"), mod = join(home, "mods/mermaid");
  const args = ["--app-home", home];
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "own.txt"), "mine");
  run(["uninstall", ...args]);
  assert.ok(existsSync(join(mod, "own.txt")));
  assert.match(run(["install", ...args]), /backup/i);
  const backups = join(state, "hmods/backups");
  const old = join(backups, readdirSync(backups)[0], "mermaid");
  assert.equal(readFileSync(join(old, "own.txt"), "utf8"), "mine");
  run(["uninstall", ...args]);
  symlinkSync(old, mod);
  run(["install", ...args]);
  assert.ok(lstatSync(mod).isDirectory());
  assert.ok(existsSync(join(old, "own.txt")));
});

test("a Markdown example can quote a Mermaid fence without adding a diagram", (t) => {
  const { cwd, run } = fixture(t);
  const quoted = "````markdown\n# Example only\n```mermaid\nnot a diagram\n```\n````\n";
  writeFileSync(join(cwd, "guide.md"), quoted + doc);
  assert.deepEqual(JSON.parse(run(["check", "guide.md", "--json"])), { diagrams: 1, problems: [] });
});

test("sync keeps nested Herdr metadata even in a directory removed from the package", (t) => {
  const { home, run } = fixture(t);
  run(["install"]);
  const mod = join(home, "mods/mermaid"), old = join(mod, "old/chunks");
  mkdirSync(old, { recursive: true });
  for (const name of ["jsconfig.json", ".hmods", "gpui-kit.d.ts", "obsolete.js"]) writeFileSync(join(old, name), "keep");
  run(["install"]);
  for (const name of ["jsconfig.json", ".hmods", "gpui-kit.d.ts"]) assert.equal(readFileSync(join(old, name), "utf8"), "keep");
  assert.equal(existsSync(join(old, "obsolete.js")), false);
});

test("check counts a stylesheet diagnostic once across blocks, sources and appearances", (t) => {
  const { home, cwd, run } = fixture(t);
  writeFileSync(join(home, "pele.css"), ":root { --pele-misspelled: var(--absent); }");
  writeFileSync(join(cwd, "flow.md"), doc + doc);
  writeFileSync(join(cwd, "other.mmd"), "sequenceDiagram\nA->>B: Hi");
  writeFileSync(join(cwd, "flow.pele.css"), ":root { --pele-radius: red; }");
  const { diagrams, problems } = JSON.parse(run(["check", ".", join(cwd, "flow.md"), "--json"], 1));
  assert.equal(diagrams, 3);
  assert.deepEqual(problems.map((p) => [p.file, p.diagram, p.message]), [
    [join(home, "pele.css"), null, "Unknown variable --pele-misspelled"],
    ["flow.pele.css", null, "Cannot resolve --pele-radius: red"],
  ]);
  assert.match(run(["check", "."], 1), /3 diagrams in 2 files, 2 problems$/);
});

test("parts reports broken blocks and still lists later matches", (t) => {
  const { cwd, invoke } = fixture(t);
  writeFileSync(join(cwd, "flow.md"), "```mermaid\nflowchart LR\nA -->\n```\n" + doc);
  const result = invoke(["parts", "flow.md", "--near", "A,Absent", "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /flow\.md:3: flowchart: /);
  assert.match(result.stderr, /^no part named Absent$/m);
  assert.doesNotMatch(result.stderr, /^no part named A$/m);
  assert.match(result.stdout, /A --> B/);
  assert.equal(JSON.parse(result.stdout).at(-1).diagram, "flow › Start");
});

test("parts warns for an unmatched source id even in a valid file", (t) => {
  const { cwd, invoke } = fixture(t);
  writeFileSync(join(cwd, "flow.md"), doc);
  const result = invoke(["parts", "flow.md", "--near", "One"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "no part named One");
});

test("check skips locally deleted tracked sources", (t) => {
  const { cwd, run } = fixture(t);
  execFileSync("git", ["init", "-q"], { cwd });
  writeFileSync(join(cwd, "gone.md"), doc);
  execFileSync("git", ["add", "gone.md"], { cwd });
  rmSync(join(cwd, "gone.md"));
  assert.deepEqual(JSON.parse(run(["check", "--json"])), { diagrams: 0, problems: [] });
});

test("explicit non-diagram files are usage errors", (t) => {
  const { cwd, run } = fixture(t);
  writeFileSync(join(cwd, "file.txt"), doc);
  for (const command of ["check", "parts"]) run([command, "file.txt"], 2);
  mkdirSync(join(cwd, "folder.md"));
  run(["parts", "folder.md"], 2);
});

test("a failed check records the new version, reports its output and continues to the skill", (t) => {
  const { cwd, home, invoke } = fixture(t);
  const mod = join(cwd, "other/mods/mermaid"), skill = join(cwd, "skills/herdr-scene");
  mkdirSync(mod, { recursive: true });
  const mark = join(mod, ".hmods");
  writeFileSync(mark, '{"tool":"hscene","version":"old"}\n');
  const checker = join(cwd, "herdr-app");
  writeFileSync(checker, `#!/bin/sh
test "$1" = check && test "$2" = "${mod}" && test "$HERDR_APP_HOME" = "${cwd}/other" || exit 2
read -r marker < "$2/.hmods"
echo "$marker"
echo invalid >&2
exit 1
`, { mode: 0o755 });
  const args = ["install", "--app-home=other", "--skill", "skills"];
  const failed = invoke(args, { PATH: cwd });
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr, "");
  assert.deepEqual(failed.stdout.trimEnd().split("\n"), [
    `check failed: ${mod}`, '  {"tool":"hscene","version":"old"}', "  invalid",
    `installed mermaid ${manifest.version} → ${mod} (check failed)`,
    `installed herdr-scene ${manifest.version} → ${skill}`,
  ]);
  assert.deepEqual(JSON.parse(readFileSync(mark)), { tool: "hscene", version: manifest.version, check: "failed" });
  assert.ok(existsSync(join(skill, "SKILL.md")));
  assert.ok(!existsSync(join(home, "mods")));
  writeFileSync(checker, "#!/bin/sh\necho successful noise\n");
  const passed = invoke(args, { PATH: cwd });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /^check passed: .*\ninstalled mermaid /);
  assert.doesNotMatch(passed.stdout, /noise/);
  assert.equal(JSON.parse(readFileSync(mark)).check, "passed");
});

test("status reports a missing mod and takes no --dry-run", (t) => {
  const { home, run } = fixture(t, { PATH: "" });
  const mod = join(home, "mods/mermaid");
  assert.deepEqual(JSON.parse(run(["status", "--json"])).mods.mermaid,
    { installed: null, check: null, package: manifest.version, path: mod });
  assert.equal(run(["status"]), "mermaid  not installed");
  run(["status", "--dry-run"], 2);
});

test("foreign targets share a collision-safe UTC backup directory for the run", (t) => {
  const { cwd, home, state, run } = fixture(t, { PATH: "" });
  const mod = join(home, "mods/mermaid"), skill = join(cwd, "skills/herdr-scene");
  mkdirSync(mod, { recursive: true });
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(mod, ".hmods"), '{"tool":"hmeter","version":"1"}');
  writeFileSync(join(skill, "personal"), "mine");
  assert.equal(run(["uninstall"]), `skipped ${mod}: not installed by hscene`);
  const root = join(state, "hmods/backups");
  for (let sec = 0; sec < 60; sec++) {
    const stamp = new Date(Date.now() + sec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    mkdirSync(join(root, stamp), { recursive: true });
  }
  const args = ["install", "--skill", "skills"];
  const before = readdirSync(root);
  const preview = run([...args, "--dry-run"]);
  assert.match(preview, /^would move .*\/\d{8}T\d{6}Z-2\/mermaid$/m);
  assert.deepEqual(readdirSync(root), before);
  const output = run(args);
  const [stamp] = readdirSync(root).filter((name) => !before.includes(name));
  assert.match(stamp, /^\d{8}T\d{6}Z-2$/);
  assert.deepEqual(readdirSync(join(root, stamp)).sort(), ["herdr-scene", "mermaid"]);
  assert.equal(readFileSync(join(root, stamp, "herdr-scene/personal"), "utf8"), "mine");
  assert.ok(output.includes(`moved ${mod} → ${join(root, stamp, "mermaid")}`));
});

test("install refreshes all owned skill copies", (t) => {
  const { state, cwd, home, run } = fixture(t, { PATH: "" });
  const record = join(state, "hmods/hscene/skill.json");
  const first = join(cwd, "first/herdr-scene"), second = join(cwd, "second/herdr-scene");
  run(["install", "--skill", "first"]);
  run(["install", "--skill", "second"]);
  for (const path of [first, second]) {
    writeFileSync(join(path, "SKILL.md"), "old");
    writeFileSync(join(path, ".hmods"), '{"tool":"hscene","version":"old"}');
  }
  run(["install"]);
  assert.deepEqual(JSON.parse(readFileSync(record)), [first, second]);
  for (const path of [first, second]) {
    assert.equal(JSON.parse(readFileSync(join(path, ".hmods"))).version, manifest.version);
    assert.match(readFileSync(join(path, "SKILL.md"), "utf8"), /^name: herdr-scene$/m);
    assert.ok(run(["status"]).includes(path));
  }
  run(["uninstall"]);
  for (const path of [record, first, second]) assert.ok(!existsSync(path));
});

test("an unowned skill stays recorded until the copy is gone", (t) => {
  const { state, cwd, home, run } = fixture(t, { PATH: "" });
  const record = join(state, "hmods/hscene/skill.json"), skill = join(cwd, "skills/herdr-scene");
  run(["install", "--skill", "skills"]);
  writeFileSync(join(skill, ".hmods"), '{"tool":"other","version":"new"}');
  writeFileSync(join(skill, "SKILL.md"), "managed elsewhere");
  run(["install"]);
  assert.equal(readFileSync(join(skill, "SKILL.md"), "utf8"), "managed elsewhere");
  run(["uninstall"]);
  assert.deepEqual(JSON.parse(readFileSync(record)), [skill]);
  rmSync(skill, { recursive: true });
  run(["install"]);
  assert.ok(!existsSync(skill));
  run(["uninstall"]);
  assert.ok(!existsSync(record));
});

test("install leaves a linked skill under its owner's control", (t) => {
  const { state, cwd, home, run } = fixture(t, { PATH: "" });
  const skill = join(cwd, "herdr-scene"), target = join(cwd, "elsewhere");
  symlinkSync(target, skill);
  for (const flags of [["--dry-run"], []]) {
    assert.ok(run(["install", "--skill", cwd, ...flags]).includes(`skipped ${skill}: a link managed elsewhere`));
    assert.ok(lstatSync(skill).isSymbolicLink());
    assert.ok(!existsSync(target));
    assert.ok(!existsSync(join(state, "hmods/hscene/skill.json")));
  }
});

test("unreadable skill records warn without blocking mod commands", (t) => {
  const { state, cwd, home, invoke } = fixture(t, { PATH: "" });
  const dir = join(state, "hmods/hscene"), record = join(dir, "skill.json");
  mkdirSync(dir, { recursive: true });
  for (const broken of ["{", '{"unexpected":"object"}', '["relative/path"]']) {
    for (const args of [["status", "--json"], ["install"], ["uninstall"], ["install", "--skill", cwd]]) {
      writeFileSync(record, broken);
      const result = invoke(args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /warning: .*skill\.json/i);
      if (args.includes("--skill")) assert.deepEqual(JSON.parse(readFileSync(record)), [join(cwd, "herdr-scene")]);
    }
  }
});
