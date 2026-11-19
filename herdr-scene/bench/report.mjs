// Tables from bench/bench.sh's output: node bench/report.mjs [out dir]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, ".cache"), "herdr-scene-bench");
const rows = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const VARIANTS = ["mv-before", "mv-after", "blueprint"];
const ms = (x) => (x === undefined ? "-" : x < 1 ? x.toFixed(3) : x.toFixed(2));
const kb = (x) => (x == null ? "-" : (x / 1024).toFixed(0));
const table = (head, body) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const time = rows("time.jsonl");
const engines = [...new Set(time.map((r) => (r.engine.startsWith("node") ? "node" : "qjs")))];
const cases = [...new Set(time.map((r) => r.case))];
const get = (v, e, c) => time.find((r) => r.variant === v && r.case === c && r.engine.startsWith(e === "node" ? "node" : "quickjs") && !r.skipped);

for (const stage of ["model", "paint", "zoom", "frame"]) {
  console.log(`\n### ${stage}: median ms (p90)\n`);
  const head = ["case", ...engines.flatMap((e) => VARIANTS.map((v) => `${e} ${v}`))];
  console.log(table(head, cases.map((c) => [c, ...engines.flatMap((e) => VARIANTS.map((v) => {
    const r = get(v, e, c)?.[stage];
    return r ? `${ms(r.median)} (${ms(r.p90)})` : "-";
  }))])));
}

console.log("\n### host calls for the first drawing (elements / builder calls / paths / path commands)\n");
console.log(table(["case", ...VARIANTS], cases.map((c) => [c, ...VARIANTS.map((v) => {
  const h = get(v, "node", c)?.host;
  return h ? `${h.elements} / ${h.calls} / ${h.paths} / ${h.pathCmds}` : "-";
})])));

console.log("\n### V8 heap held after GC, KB (model / paint)\n");
console.log(table(["case", ...VARIANTS], cases.map((c) => [c, ...VARIANTS.map((v) => {
  const r = get(v, "node", c)?.retained;
  return r ? `${kb(r.model)} / ${kb(r.paint)}` : "-";
})])));

const mem = rows("memory.jsonl");
if (mem.length) {
  console.log("\n### process memory, KB: peak RSS node / peak RSS qjs / QuickJS heap in use\n");
  const mcases = [...new Set(mem.map((r) => r.case))];
  console.log(table(["case", ...VARIANTS], mcases.map((c) => [c, ...VARIANTS.map((v) => {
    const r = mem.find((x) => x.variant === v && x.case === c);
    return r ? `${kb(r.node_rss)} / ${kb(r.qjs_rss)} / ${kb(r.qjs_heap)}` : "-";
  })])));
}
