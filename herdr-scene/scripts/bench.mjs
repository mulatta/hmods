// Times the fork's renderScene on generated flowcharts. Runs under Node or
// QuickJS (qjs): node scripts/bench.mjs, qjs scripts/bench.mjs.
import * as pele from "../build/pele.js";

const now = () => globalThis.performance?.now?.() ?? Date.now();
const log = globalThis.print ?? console.log;

function flowchart(n) {
  const lines = ["flowchart TD"];
  for (let i = 1; i < n; i++) {
    const p = Math.floor((i - 1) / 2);
    lines.push(`  n${p}[Node ${p}] --> n${i}[Node ${i}]`);
    if (i % 7 === 0) lines.push(`  n${i} -.-> n${Math.floor(i / 3)}`);
  }
  return lines.join("\n") + "\n";
}

const time = (f, ms = 1500) => {
  for (let i = 0; i < 3; i++) f();
  const t0 = now();
  let k = 0;
  while (now() - t0 < ms) {
    f();
    k++;
  }
  return (now() - t0) / k;
};

for (const n of [20, 100, 400]) {
  const src = flowchart(n);
  const ms = time(() => pele.renderScene(src));
  log(`flowchart ${String(n).padStart(3)}  ${ms.toFixed(2).padStart(6)} ms`);
}
