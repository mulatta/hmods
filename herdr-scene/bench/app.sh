#!/usr/bin/env bash
# Measures mermaid and Blueprint inside a running Herdr window: the whole
# app process, so path drawing, text layout and the GPU work count too.
#
#   HERDR_APP_HOME=<home> bench/app.sh <out dir> [mod...]
#
# The window at HERDR_APP_HOME (a home of its own, so its overlays, shared
# state and data stay apart from the window in use) must have both mods
# installed as overlays (`mod.open:<mod>`) with the same diagrams in the same
# tab order: mermaid's session for the focused terminal listing the
# files, Blueprint's project folder holding copies. No overlay open. For
# each mod: idle CPU and memory with no overlay, then opened, then on each
# tab a switch, a zoom loop (sampled into a native flame graph) and idle.
# Each step prints one JSON line: CPU seconds the process used, wall
# seconds, and footprint (dirty memory, MB) with its malloc and graphics parts.
set -euo pipefail

out=${1:?out dir}
shift
[ $# -gt 0 ] || set -- mermaid blueprint
mods=("$@")
: "${HERDR_APP_HOME:?set it to the home of the window to measure}"
mkdir -p "$out"
pid=$(pgrep -nx herdr-app)
fg=$(nix build --no-link --print-out-paths nixpkgs#flamegraph)/bin
do_() { herdr-app "do" "$@" >/dev/null; }

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }
cpu() { ps -o cputime= -p "$pid" | awk -F: '{ s = 0; for (i = 1; i <= NF; i++) s = s * 60 + $i; printf "%.2f", s }'; }
mem() {
  footprint -p "$pid" 2>/dev/null | awk '
    function mb(v, u) { return u == "GB" ? v * 1024 : u == "MB" ? v : u == "KB" ? v / 1024 : v / 1048576 }
    /Footprint:/ { for (i = 1; i <= NF; i++) if ($i == "Footprint:") total = mb($(i + 1), $(i + 2)) }
    /Malloc/ { malloc += mb($1, $2) }
    /graphics|IOSurface|IOAccelerator/ { gfx += mb($1, $2) }
    END { printf "{\"footprint\":%.1f,\"malloc\":%.1f,\"graphics\":%.1f}", total, malloc, gfx }'
}
# step <mod> <name> <secs> [command...]: runs the command, waits, reports.
step() {
  local mod=$1 name=$2 secs=$3
  shift 3
  local c0 t0 c1 t1
  c0=$(cpu)
  t0=$(now)
  if [ $# -gt 0 ]; then "$@"; fi
  sleep "$secs"
  c1=$(cpu)
  t1=$(now)
  printf '{"mod":"%s","step":"%s","cpu":%s,"wall":%s,"mem":%s}\n' "$mod" "$name" \
    "$(awk -v a="$c0" -v b="$c1" 'BEGIN { printf "%.2f", b - a }')" "$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.3f", b - a }')" "$(mem)" | tee -a "$out/app.jsonl"
}
zoom_loop() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    do_ "$1.zoom-in"
    sleep 0.25
    do_ "$1.zoom-out"
    sleep 0.25
  done
}

for mod in "${mods[@]}"; do
  first=0
  [ "$mod" = blueprint ] && first=1
  step "$mod" idle-closed 5
  step "$mod" open 6 do_ "mod.open:$mod"
  for n in 0 1 2; do
    step "$mod" "tab$n-switch" 4 do_ "$mod.tab-$((n + first))"
    herdr-app shot "$out/$mod-tab$n.png" >/dev/null # what was drawn (or "Drawing...")
    sample "$pid" 5 -file "$out/$mod-tab$n.sample" >/dev/null 2>&1 &
    sampler=$!
    step "$mod" "tab$n-zoom" 0.1 zoom_loop "$mod"
    wait "$sampler" || true
    awk -f "$fg/stackcollapse-sample.awk" "$out/$mod-tab$n.sample" >"$out/$mod-tab$n.folded"
    "$fg/flamegraph.pl" --title "$mod tab $n: zoom loop, whole app" "$out/$mod-tab$n.folded" >"$out/$mod-tab$n.svg"
    step "$mod" "tab$n-idle" 5
  done
  step "$mod" closed 4 do_ "mod.open:$mod"
done
