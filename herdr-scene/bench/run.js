// Runs one variant (bundled in with it by bench/build.sh) under Node or QuickJS.
//
//   run.js <cases.json> time [ms] [case...]   median and p90 of each stage, host calls
//   run.js <cases.json> keep <case>           holds one case's drawing, then exits:
//                                             for a memory dump (qjs -d) or RSS
//   run.js <cases.json> loop <case> <secs>    model and paint over and over, for a profiler
//
// Stages: model (text -> what is drawn: scene, or layout), paint (the first
// drawing at the fitted view), zoom (drawn again a step in or out), frame (a
// later render over that drawing).
import * as variant from "variant";
import { counts, resetCounts } from "./stubs/gpui-kit.js";

const { model, paint, frame, zoom } = variant;

const isNode = typeof process === "object" && !!process.versions?.node;
const args = isNode ? process.argv.slice(2) : globalThis.scriptArgs.slice(1);
const out = (s) => (isNode ? console.log(s) : globalThis.print(s));
const now = () => performance.now();
const gc = () => globalThis.gc?.();
const heap = () => (isNode ? process.memoryUsage().heapUsed : null);

async function readText(path) {
  if (isNode) return (await import("node:fs")).readFileSync(path, "utf8");
  return (await import("qjs:std")).loadFile(path);
}

const SIZE = { width: 1200, height: 800 };
const [casesPath, mode = "time", ...rest] = args;
const cases = JSON.parse(await readText(casesPath));
const engine = isNode ? `node ${process.versions.node}` : "quickjs-ng";

// Times f until `ms` have passed (at least 5 runs), after 3 warm-up runs.
function sample(f, ms) {
  for (let i = 0; i < 3; i++) f();
  const times = [];
  const t0 = now();
  while (times.length < 5 || now() - t0 < ms) {
    const t = now();
    f();
    times.push(now() - t);
  }
  times.sort((a, b) => a - b);
  return { median: times[times.length >> 1], p90: times[Math.floor(times.length * 0.9)], runs: times.length };
}

function supported(c) {
  if (variant.flowchartOnly && !c.flowchart) return false;
  try {
    paint(model(c.src), SIZE);
    return true;
  } catch {
    return false;
  }
}

if (mode === "time") {
  const ms = Number(rest[0] ?? 1000);
  const only = rest.slice(1);
  for (const c of cases) {
    if (only.length && !only.includes(c.name)) continue;
    if (!supported(c)) {
      out(JSON.stringify({ engine, case: c.name, skipped: true }));
      continue;
    }
    const m = model(c.src);
    resetCounts();
    const drawn = paint(m, SIZE);
    const host = { ...counts };
    resetCounts();
    frame(drawn);
    const frameHost = { ...counts };
    // What a drawing holds, over ten held at once: one alone is lost in the heap's noise.
    gc();
    const h0 = heap();
    const kept = Array.from({ length: 10 }, () => model(c.src));
    gc();
    const h1 = heap();
    const keptDrawn = kept.map((k) => paint(k, SIZE));
    gc();
    const h2 = heap();
    out(JSON.stringify({
      engine, case: c.name,
      model: sample(() => model(c.src), ms),
      paint: sample(() => paint(m, SIZE), ms),
      zoom: (() => {
        let k = 1.25;
        const r = sample(() => {
          zoom(drawn, k);
          k = 1 / k;
        }, ms);
        return r;
      })(),
      frame: sample(() => frame(drawn), ms),
      host, frameHost,
      retained: h0 === null ? null : { model: (h1 - h0) / 10, paint: (h2 - h1) / 10 },
      keep: keptDrawn.length,
    }));
  }
} else if (mode === "keep") {
  // No such case (or one the variant does not read): the variant loaded, nothing drawn.
  const c = cases.find((x) => x.name === rest[0]);
  if (c && supported(c)) globalThis.kept = paint(model(c.src), SIZE);
  gc();
} else if (mode === "loop") {
  const c = cases.find((x) => x.name === rest[0]);
  if (!c || !supported(c)) out(JSON.stringify({ engine, case: rest[0], skipped: true }));
  else {
    const until = now() + Number(rest[1] ?? 10) * 1000;
    let n = 0;
    while (now() < until) {
      paint(model(c.src), SIZE);
      n++;
    }
    out(JSON.stringify({ engine, case: c.name, loops: n }));
  }
}
