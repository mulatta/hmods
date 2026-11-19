import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };

const version = manifest.version;
const skillName = "herdr-scene";
const here = new URL("./", import.meta.url);
export const data = fileURLToPath(existsSync(new URL("mods/mermaid", here)) ? here : new URL("../", here));
const keep = new Set(["gpui-kit.d.ts", "jsconfig.json", ".hmods"]);
const stat = (path) => lstatSync(path, { throwIfNoEntry: false });

function marker(target) {
  if (!stat(target)?.isDirectory()) return null;
  const file = join(target, ".hmods");
  if (!stat(file)?.isFile()) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record?.tool === "hscene" && typeof record.version === "string" ? record : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

function writeIfChanged(path, content) {
  if (stat(path)?.isFile()) {
    try { if (readFileSync(path, "utf8") === content) return; }
    catch (e) { if (e.code !== "EACCES") throw e; }
  }
  const tmp = mkdtempSync(join(dirname(path), ".hscene-"));
  try {
    writeFileSync(join(tmp, "new"), content);
    renameSync(join(tmp, "new"), path);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Herdr writes type files beside nested modules, including under vendor/chunks.
function prune(path) {
  if (keep.has(basename(path))) return;
  if (stat(path)?.isDirectory()) {
    for (const name of readdirSync(path)) prune(join(path, name));
    if (!readdirSync(path).length) rmdirSync(path);
  } else rmSync(path, { force: true });
}

function syncTree(src, dst) {
  const entries = readdirSync(src, { withFileTypes: true });
  const wanted = new Set(entries.map((entry) => entry.name));
  for (const name of readdirSync(dst)) {
    if (!wanted.has(name)) prune(join(dst, name));
  }
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    const from = join(src, entry.name), to = join(dst, entry.name);
    const current = stat(to);
    if (entry.isDirectory()) {
      if (current && !current.isDirectory()) rmSync(to, { recursive: true });
      mkdirSync(to, { recursive: true });
      syncTree(from, to);
    } else {
      if (!entry.isFile()) throw new Error(`Expected package file: ${from}`);
      if (current?.isFile() && readFileSync(from).equals(readFileSync(to))) {
        if (!(current.mode & 0o200)) chmodSync(to, (current.mode & 0o777) | 0o200);
        continue;
      }
      if (current?.isDirectory()) prune(to);
      // Rename a complete writable file into place for the live file watcher.
      const tmp = mkdtempSync(join(dst, ".hscene-"));
      try {
        const staged = join(tmp, "new");
        copyFileSync(from, staged);
        chmodSync(staged, (stat(from).mode & 0o777) | 0o600);
        renameSync(staged, to);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
}

const stateHome = () => resolve(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "hmods");

function backupDirectory(dry) {
  const root = join(stateHome(), "backups");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  if (!dry) mkdirSync(root, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = join(root, n === 1 ? stamp : `${stamp}-${n}`);
    if (dry) {
      if (!stat(dir)) return dir;
    } else {
      try { mkdirSync(dir); return dir; }
      catch (e) { if (e.code !== "EEXIST") throw e; }
    }
  }
}

function backup(target, run) {
  run.backupDir ??= backupDirectory(run.dry);
  const dest = join(run.backupDir, basename(target));
  if (!run.dry) {
    try { renameSync(target, dest); }
    catch (e) {
      if (e.code !== "EXDEV") throw e;
      cpSync(target, dest, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      rmSync(target, { recursive: true });
    }
  }
  console.log(`${run.dry ? "would move" : "moved"} ${target} → ${dest}`);
}

function resolved(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(resolved(dirname(path)), basename(path));
}

function checkMod(mod, appHome) {
  const result = spawnSync("herdr-app", ["check", mod], { encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: appHome } });
  if (result.error?.code === "ENOENT") return "skipped";
  if (result.status === 0) {
    console.log(`check passed: ${mod}`);
    return "passed";
  }
  console.log(`check failed: ${mod}`);
  for (const text of [result.stdout, result.stderr, result.error?.message]) {
    if (text) console.log(text.trimEnd().split(/\r?\n/).map((line) => "  " + line).join("\n"));
  }
  return "failed";
}

function installTree(src, dst, run, check) {
  const { dry } = run;
  const target = stat(dst);
  const from = realpathSync(src);
  // A clone can itself be the user's share folder. Never sync it into itself.
  const to = join(resolved(dirname(dst)), basename(dst));
  if (to === from || from.startsWith(to + sep) || to.startsWith(from + sep)) throw new Error(`Install paths overlap: ${src}, ${dst}`);
  if (target?.isSymbolicLink()) {
    if (!dry) rmSync(dst);
    console.log(`${dry ? "would remove" : "removed"} link ${dst}`);
  } else if (target && marker(dst) === null) backup(dst, run);
  let state;
  if (!dry) {
    mkdirSync(dst, { recursive: true });
    syncTree(src, dst);
    state = check?.();
    writeIfChanged(join(dst, ".hmods"), JSON.stringify({ tool: "hscene", version, check: state }) + "\n");
  }
  console.log(`${dry ? "would install" : "installed"} ${basename(dst)} ${version} → ${dst}${state === "failed" ? " (check failed)" : ""}`);
  return state !== "failed";
}

function uninstallTree(path, dry) {
  if (marker(path) === null) {
    console.log(`skipped ${path}: not installed by hscene`);
    return false;
  }
  if (!dry) rmSync(path, { recursive: true });
  console.log(`${dry ? "would uninstall" : "uninstalled"} ${basename(path)} → ${path}`);
  return true;
}

function skillPaths(file) {
  try {
    const entry = stat(file);
    if (!entry) return new Set();
    if (!entry.isFile()) throw new Error("expected a regular file");
    const paths = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(paths) || !paths.every((p) =>
      typeof p === "string" && !p.includes("\0") && resolve(p) === p && basename(p) === skillName)) {
      throw new Error("expected absolute herdr-scene paths");
    }
    return new Set(paths);
  } catch (e) {
    console.error(`warning: cannot read ${file}: ${e.message}`);
    return new Set();
  }
}

function showStatus(mod, paths, json) {
  const current = marker(mod);
  const info = { installed: current?.version ?? null, check: current?.check ?? null, package: version, path: mod };
  const skills = [...paths].map((path) => ({ path, installed: marker(path)?.version ?? null, package: version }));
  if (json) {
    const status = { mods: { mermaid: info } };
    if (skills.length) status.skills = skills;
    console.log(JSON.stringify(status));
    return;
  }
  const outdated = info.installed !== version ? ": outdated, run `hscene install`" : "";
  console.log(current ? `mermaid  installed ${info.installed} (check ${info.check}), package ${version}${outdated}` : "mermaid  not installed");
  for (const skill of skills) {
    const description = skill.installed === null ? "not installed"
      : skill.installed === version ? version : `${skill.installed} (outdated)`;
    console.log(`${basename(skill.path)}  ${description} (package ${version}) → ${skill.path}`);
  }
}

export function installation(command, appHome, options) {
  const mod = join(appHome, "mods/mermaid");
  const record = join(stateHome(), "hscene/skill.json");
  const paths = skillPaths(record);
  if (command === "status") {
    showStatus(mod, paths, options.json);
    return 0;
  }

  const dry = options["dry-run"], run = { dry };
  let ok = true;
  try {
    if (command === "install") ok = installTree(join(data, "mods/mermaid"), mod, run, () => checkMod(mod, appHome));
    else uninstallTree(mod, dry);
  } catch (e) {
    console.error(e.message);
    ok = false;
  }

  const requested = options.skill && resolve(options.skill, skillName);
  const targets = new Set(paths);
  if (requested) targets.add(requested);
  for (const path of targets) {
    try {
      if (stat(path)?.isSymbolicLink()) {
        console.log(`skipped ${path}: a link managed elsewhere`);
      } else if (command === "uninstall") {
        if (uninstallTree(path, dry) || !stat(path)) paths.delete(path);
      } else if (path === requested || marker(path)) {
        installTree(join(data, "skills", skillName), path, run);
        paths.add(path);
      } else console.log(`skipped ${path}: not installed by hscene`);
    } catch (e) {
      console.error(e.message);
      ok = false;
    }
  }
  if (!dry && paths.size && targets.size) {
    mkdirSync(dirname(record), { recursive: true });
    writeIfChanged(record, JSON.stringify([...paths]) + "\n");
  } else if (!dry && command === "uninstall" && targets.size) rmSync(record);
  return ok ? 0 : 1;
}
