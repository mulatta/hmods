#!/usr/bin/env bash
# Times, memory and flame graphs for mermaid before and after the fork,
# and Blueprint, under Node (V8) and QuickJS-ng. Run bench/build.sh first.
#
#   bench/bench.sh time    [ms]          every stage of every case -> time.jsonl
#   bench/bench.sh memory  [case...]     peak RSS and, for QuickJS, its heap -> memory.jsonl
#   bench/bench.sh profile <case> [secs] CPU and allocation flame graphs -> flame/*.svg
#                                        (V8, V8 without JIT, QuickJS native)
#
# QUICKJS picks the qjs binary (default: qjs on PATH, else nixpkgs#quickjs-ng).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${BENCH_OUT:-${XDG_CACHE_HOME:-$HOME/.cache}/herdr-scene-bench}
cd "$out"
node=$(command -v node)
qjs=${QUICKJS:-$(command -v qjs || echo "$(nix build --no-link --print-out-paths 'nixpkgs#quickjs-ng.bin')/bin/qjs")}
variants=(mv-before mv-after blueprint)
cases() { "$node" -e 'console.log(JSON.parse(require("fs").readFileSync("cases.json","utf8")).map(c=>c.name).join(" "))'; }

case ${1:-time} in
time)
  ms=${2:-1000}
  : >time.jsonl
  for v in "${variants[@]}"; do
    "$node" --expose-gc "$v.js" cases.json time "$ms" | sed "s/^{/{\"variant\":\"$v\",/" >>time.jsonl
    "$qjs" -m "$v.js" cases.json time "$ms" | sed "s/^{/{\"variant\":\"$v\",/" >>time.jsonl
  done
  echo "$out/time.jsonl"
  ;;
memory)
  shift
  list=${*:-$(cases)}
  : >memory.jsonl
  # Peak RSS of a process that only loads the variant, then of one holding a case's drawing.
  rss() { /usr/bin/time -l "$@" 2>&1 >/dev/null | awk '/maximum resident set size/ {print $1}'; }
  # QuickJS's own count of what it holds at exit (bytes in use).
  qheap() { "$qjs" -d -m "$@" 2>&1 | awk '/^memory used/ {print $4}'; }
  for v in "${variants[@]}"; do
    for c in "" $list; do
      name=${c:-none}
      [ -z "$c" ] && c=__none__
      printf '{"variant":"%s","case":"%s","node_rss":%s,"qjs_rss":%s,"qjs_heap":%s}\n' "$v" "$name" \
        "$(rss "$node" --expose-gc "$v.js" cases.json keep "$c" || echo null)" \
        "$(rss "$qjs" -m "$v.js" cases.json keep "$c" || echo null)" \
        "$(qheap "$v.js" cases.json keep "$c" || echo null)" >>memory.jsonl
    done
  done
  echo "$out/memory.jsonl"
  ;;
profile)
  c=${2:?case}
  secs=${3:-8}
  fg=$(nix build --no-link --print-out-paths nixpkgs#flamegraph)/bin
  mkdir -p flame
  for v in "${variants[@]}"; do
    # V8: where JavaScript time and allocation go, by function.
    rm -rf prof && mkdir prof
    if "$node" --cpu-prof --cpu-prof-dir=prof --heap-prof --heap-prof-dir=prof "$v.js" cases.json loop "$c" "$secs" | grep -q skipped; then
      continue # Blueprint draws flowcharts only
    fi
    "$node" "$root/bench/fold.mjs" prof/*.cpuprofile >"flame/$v-$c-node-cpu.folded"
    "$node" "$root/bench/fold.mjs" prof/*.heapprofile >"flame/$v-$c-node-alloc.folded"
    "$fg/flamegraph.pl" --title "$v $c: V8 CPU" "flame/$v-$c-node-cpu.folded" >"flame/$v-$c-node-cpu.svg"
    "$fg/flamegraph.pl" --title "$v $c: V8 allocation" --countname bytes --colors mem "flame/$v-$c-node-alloc.folded" >"flame/$v-$c-node-alloc.svg"
    # V8 without its JIT interprets, as QuickJS does: closer to where QuickJS's
    # time goes, by JavaScript function.
    rm -rf prof && mkdir prof
    "$node" --jitless --cpu-prof --cpu-prof-dir=prof "$v.js" cases.json loop "$c" "$secs" >/dev/null
    "$node" "$root/bench/fold.mjs" prof/*.cpuprofile >"flame/$v-$c-jitless-cpu.folded"
    "$fg/flamegraph.pl" --title "$v $c: V8 jitless CPU" "flame/$v-$c-jitless-cpu.folded" >"flame/$v-$c-jitless-cpu.svg"
    # QuickJS keeps no JavaScript stacks a sampler can read: its native stack
    # says where the interpreter spends (GC, property lookup, strings, regexps).
    "$qjs" -m "$v.js" cases.json loop "$c" "$((secs + 2))" >/dev/null &
    pid=$!
    sleep 1
    sample "$pid" "$secs" -file "prof/qjs.sample" >/dev/null 2>&1 || true
    wait "$pid"
    awk -f "$fg/stackcollapse-sample.awk" prof/qjs.sample >"flame/$v-$c-qjs-cpu.folded"
    "$fg/flamegraph.pl" --title "$v $c: QuickJS native CPU" "flame/$v-$c-qjs-cpu.folded" >"flame/$v-$c-qjs-cpu.svg"
  done
  rm -rf prof
  echo "$out/flame"
  ;;
*)
  sed -n 2,10p "$0"
  exit 2
  ;;
esac
