#!/usr/bin/env bash
# Prepares a Herdr home of its own for bench/app.sh, so the measured window's
# overlays, shared state and data stay apart from the window in use:
#
#   bench/app-setup.sh <home> <terminal> <project folder>
#
# <home>      a short path (the control socket lives there; macOS caps its length)
# <terminal>  the terminal the measured window will have focused (`herdr-app status`)
# <project>   that terminal's folder as Blueprint sees it (its git top level)
#
# Both mods are copied from ~/.config/herdr-app/mods. Blueprint opens as a
# pane or panel; its copy here also opens as an overlay the size of
# mermaid's, serving the tab on screen. The generated flowcharts of
# cases.json (bench/build.sh) go to both: mermaid's session for
# <terminal>, and Blueprint's folder for <project>, in the same tab order.
# Then: HERDR_APP_HOME=<home> herdr-app (the window), HERDR_APP_HOME=<home> bench/app.sh <out>.
set -euo pipefail

home=${1:?home}
terminal=${2:?terminal}
project=${3:?project folder}
cache=${XDG_CACHE_HOME:-$HOME/.cache}/herdr-scene-bench
mkdir -p "$home/mods" "$cache/app-diagrams"
for mod in mermaid blueprint; do
  rm -rf "${home:?}/mods/$mod"
  cp -R "$HOME/.config/herdr-app/mods/$mod" "$home/mods/"
done

python3 - "$home" "$terminal" "$project" "$cache" <<'EOF'
import json, os, sys, time

home, terminal, project, cache = sys.argv[1:]
cases = {c["name"]: c["src"] for c in json.load(open(f"{cache}/cases.json"))}
names = [("a-flow-60", "flow-60"), ("b-flow-150", "flow-150"), ("c-flow-400", "flow-400")]

def fnv(s):  # Blueprint's project folder hash (store.js)
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"

name = "-".join([p for p in project.split("/") if p][-2:])
bp = f"{home}/data/blueprint/projects/{name}-{fnv(project)}"
os.makedirs(bp, exist_ok=True)
files = []
for f, c in names:
    path = f"{cache}/app-diagrams/{f}.mmd"
    for p in (path, f"{bp}/{f}.mmd"):
        open(p, "w").write(cases[c])
    files.append({"machine": None, "path": path, "blocks": None})

shared_path = f"{home}/shared.json"
shared = json.load(open(shared_path)) if os.path.exists(shared_path) else {}
shared["mermaid.sessions"] = {terminal: {"files": files, "tab": files[0]["path"] + "#0", "views": {}, "order": [], "pins": [], "at": int(time.time() * 1000)}}
json.dump(shared, open(shared_path, "w"))

mod = f"{home}/mods/blueprint/mod.json"
m = json.load(open(mod))
m["overlay"] = {"kind": "window", "key": "blueprint", "width": 0.62, "height": 0.72}
json.dump(m, open(mod, "w"))
main = f"{home}/mods/blueprint/main.js"
s = open(main).read()
old = "    if (!this.inPanel) return this.ownTab ?? null;"
assert s.count(old) == 1, "Blueprint's servedTab changed: update bench/app-setup.sh"
open(main, "w").write(s.replace(old, "    if (!this.inPanel) return this.ownTab ?? this.shownTab(); // bench: an overlay serves the tab on screen"))
print(bp)
EOF
