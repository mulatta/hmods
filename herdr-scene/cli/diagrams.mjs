import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { detectType, parse, renderScene } from "../build/pele.js";
import { peleCss, themeVars } from "../src/paint.js";
import { isSource, partText, roleOf, sceneLabels, tabsFromFile } from "../mods/mermaid/sources.js";
import { partIndex } from "../mods/mermaid/session.js";

function filesIn(paths) {
  if (!paths.length) {
    return execFileSync("git", ["ls-files", "--cached", "-z", "--", "."], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
      .split("\0").filter((file) => isSource(file) && existsSync(file));
  }
  const files = new Map();
  function visit(path) {
    if (!statSync(path).isDirectory()) {
      const absolute = resolve(path);
      if (!files.has(absolute)) files.set(absolute, normalize(path));
      return;
    }
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (item.name === ".git") continue;
      if (item.isDirectory() || (item.isFile() && isSource(item.name))) visit(join(path, item.name));
    }
  }
  paths.forEach(visit);
  return [...files.values()].sort();
}

function stylesheet(file) {
  try {
    return { file, text: readFileSync(file, "utf8") };
  } catch (e) {
    if (e.code === "ENOENT") return { file, text: "" };
    throw e;
  }
}

// The host supplies all its theme colors. Their particular hues do not affect validation.
const theme = Object.fromEntries(["background", "foreground", "muted", "surface", "raised", "border", "accent"].map((k) => [k, "#ffffff"]));
function collectCssProblems(sheets, warnings) {
  for (const dark of [false, true]) {
    peleCss(sheets.map((s) => s.text), dark, themeVars(theme), ({ sheet, line, message }) => {
      const warning = { file: sheets[sheet].file, line, message };
      const key = JSON.stringify([resolve(warning.file), line, message]);
      if (!warnings.has(key)) warnings.set(key, warning);
    });
  }
}

function parseProblem(file, tab, error) {
  const line = error.line || Number(error.message.match(/error on line (\d+)/i)?.[1]) || 1;
  let type = error.type;
  if (!type) {
    // Preprocessing itself can fail before pele identifies a diagram.
    try { type = detectType(tab.src); } catch {}
  }
  return { file, line: tab.line0 + line, diagram: tab.name, type: type ?? "mermaid", kind: "parse", message: error.message };
}

function diagnostic(p) {
  return `${p.file}:${p.line}: ${p.type ?? p.kind}: ${p.message.replace(/\s*\n\s*/g, " ")}`;
}

export function check(paths, appHome, json) {
  const problems = [], warnings = new Map();
  let diagrams = 0, files = 0;
  const global = stylesheet(join(appHome, "pele.css"));
  for (const file of new Set(filesIn(paths))) {
    const tabs = tabsFromFile(file, readFileSync(file, "utf8"));
    if (!tabs.length) continue;
    files++;
    diagrams += tabs.length;
    const sidecar = stylesheet(file.slice(0, -extname(file).length) + ".pele.css");
    collectCssProblems([global, sidecar], warnings);
    for (const tab of tabs) {
      try {
        parse(tab.src);
      } catch (e) {
        problems.push(parseProblem(file, tab, e));
      }
    }
  }
  for (const w of warnings.values()) problems.push({ ...w, diagram: null, type: null, kind: "css" });
  if (json) console.log(JSON.stringify({ diagrams, problems }));
  else {
    for (const p of problems) console.log(diagnostic(p));
    console.log(`${diagrams} diagrams in ${files} files, ${problems.length} problems`);
  }
  return problems.length ? 1 : 0;
}

export function parts(file, near, json) {
  const source = readFileSync(file, "utf8"), lines = source.split(/\r?\n/);
  const results = [], output = [];
  const missing = new Set(near);
  let failed = false;
  for (const tab of tabsFromFile(file, source)) {
    let scene;
    try {
      ({ scene } = renderScene(tab.src, { sourceInfo: true }));
    } catch (e) {
      console.error(diagnostic(parseProblem(file, tab, e)));
      failed = true;
      continue;
    }
    const labels = sceneLabels(scene);
    const items = scene.items.map((p, i) => ({ ...p, label: labels[i] }));
    const range = [tab.line0 + 1, tab.line0 + tab.src.replace(/\n$/, "").split("\n").length];
    const result = { diagram: tab.name, file, lines: range };
    output.push(`${tab.name} (lines ${range.join("-")})`);
    const matches = new Set();
    const named = [];
    for (const [i, p] of items.entries()) {
      if (partIndex(items, i) !== i) continue;
      const line = p.line == null ? null : tab.line0 + p.line;
      const end = p.end == null ? null : tab.line0 + p.end;
      if (near) {
        const names = [p.symbol, p.from, p.to].filter((name) => near.has(name));
        for (const name of names) missing.delete(name);
        if (line && names.length) {
          for (let n = line; n <= (end ?? line); n++) matches.add(n);
        }
      } else {
        const text = partText(tab, p, true);
        named.push({
          role: roleOf(p), symbol: p.symbol ?? null, from: p.from ?? null, to: p.to ?? null,
          label: p.label, line, end, quote: line ? lines[line - 1].trim() : null, text,
        });
        output.push(text);
      }
    }
    if (near) {
      result.lines = [...matches].sort((a, b) => a - b).map((line) => ({ line, text: lines[line - 1] }));
      for (const entry of result.lines) output.push(`${entry.line}: ${entry.text}`);
    } else result.parts = named;
    results.push(result);
  }
  if (json) console.log(JSON.stringify(results));
  else if (output.length) console.log(output.join("\n"));
  for (const name of missing) console.error(`no part named ${name}`);
  return failed || missing.size ? 1 : 0;
}
