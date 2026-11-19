// V8 profiles to folded stacks for flamegraph.pl: node bench/fold.mjs <file>
//   .cpuprofile   (node --cpu-prof)   weight: samples
//   .heapprofile  (node --heap-prof)  weight: bytes allocated, sampled
import { readFileSync } from "node:fs";

const file = process.argv[2];
const p = JSON.parse(readFileSync(file, "utf8"));
const out = new Map();
const add = (stack, w) => w > 0 && out.set(stack, (out.get(stack) ?? 0) + w);
const name = (f) => {
  const where = f.url ? f.url.split("/").pop() : "";
  return `${f.functionName || "(anonymous)"}${where ? ` ${where}:${f.lineNumber + 1}` : ""}`.replace(/;/g, ",");
};

if (file.endsWith(".cpuprofile")) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const stackOf = (id) => {
    const names = [];
    for (let n = byId.get(id); n; n = byId.get(parent.get(n.id))) if (n.callFrame.functionName !== "(root)") names.push(name(n.callFrame));
    return names.reverse().join(";");
  };
  const counts = new Map();
  for (const s of p.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [id, k] of counts) add(stackOf(id), k);
} else {
  const walk = (n, path) => {
    const here = n.callFrame.functionName === "(root)" ? path : [...path, name(n.callFrame)];
    add(here.join(";"), n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(p.head, []);
}
for (const [stack, w] of out) if (stack) console.log(`${stack} ${w}`);
