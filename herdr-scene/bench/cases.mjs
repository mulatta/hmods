// Writes the bench's diagrams to a JSON file: node bench/cases.mjs <out.json>
//
//   flow-N   generated flowcharts in the subset Blueprint reads too (shapes,
//            edge labels, dashed and thick edges), so all three variants draw
//            the same diagram
//   <type>   the largest corpus diagram of a type that draws, for mermaid before
//            and after (Blueprint reads flowcharts only and skips the rest)
import { writeFileSync } from "node:fs";
import corpus from "../tests/fixtures/corpus.js";
import { renderScene } from "../build/pele.js";

// A fixed seed: every run draws the same diagrams.
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const SHAPES = [(t) => `[${t}]`, (t) => `(${t})`, (t) => `{${t}}`, (t) => `([${t}])`, (t) => `[(${t})]`];
const WORDS = ["parse", "check", "load", "build", "ship", "retry", "cache", "index", "merge", "review", "deploy", "notify"];
const word = () => WORDS[Math.floor(rnd() * WORDS.length)];

function flowchart(n) {
  seed = n;
  const lines = ["flowchart TD"];
  for (let i = 0; i < n; i++) lines.push(`  n${i}${SHAPES[i % SHAPES.length](`${word()} ${word()} ${i}`)}`);
  for (let i = 1; i < n; i++) {
    const p = Math.floor(rnd() * Math.min(i, 4)) + Math.max(0, i - 4);
    const r = rnd();
    lines.push(r < 0.15 ? `  n${p} -->|${word()}| n${i}` : r < 0.25 ? `  n${p} -.-> n${i}` : r < 0.3 ? `  n${p} ==> n${i}` : `  n${p} --> n${i}`);
    if (i % 9 === 0) lines.push(`  n${i} -.-> n${Math.floor(i / 3)}`);
  }
  return lines.join("\n") + "\n";
}

const cases = [20, 60, 150, 400].map((n) => ({ name: `flow-${n}`, src: flowchart(n), flowchart: true }));
for (const type of ["flowchart", "sequence", "class", "state", "er", "gantt", "git", "mindmap", "c4", "architecture"]) {
  const draws = (src) => {
    try {
      return !!renderScene(src).scene;
    } catch {
      return false;
    }
  };
  const srcs = (corpus[type] ?? []).map((e) => (typeof e === "string" ? e : e.src)).filter(draws);
  if (srcs.length) cases.push({ name: type, src: srcs.reduce((a, b) => (b.length > a.length ? b : a)) });
}
writeFileSync(process.argv[2], JSON.stringify(cases));
console.log(cases.map((c) => `${c.name}: ${c.src.split("\n").length} lines`).join("\n"));
