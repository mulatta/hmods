#!/usr/bin/env bash
# Bundles the bench runner with each variant, unminified so profiles keep
# their names (not --keep-names: it adds a call to every closure made): bench/build.sh [out dir]
#   mv-before  mermaid on upstream pele (SVG text, read back)
#   mv-after   mermaid on the fork (scene drawn directly, sources recorded)
#   blueprint  the installed Blueprint mod (BLUEPRINT=<dir> picks another)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-${XDG_CACHE_HOME:-$HOME/.cache}/herdr-scene-bench}
blueprint=${BLUEPRINT:-$HOME/.config/herdr-app/mods/blueprint}
mkdir -p "$out"

if command -v esbuild >/dev/null 2>&1; then
  esbuild() { command esbuild "$@"; }
else
  esbuild() { nix run nixpkgs#esbuild -- "$@"; }
fi

pele=$(bash "$root/scripts/pele-src.sh")
# The fork starts from the 1.13.0 release; the baseline still renders SVG.
upstream=$out/pele-1.13.0
if [[ ! -d $upstream ]]; then
  git clone --quiet --depth 1 --branch 1.13.0 https://github.com/obsidianmd/pele.git "$upstream"
fi

cd "$root"
bundle() {
  local name=$1 variant=$2 pele=$3
  esbuild bench/run.js --bundle --format=esm --target=es2022 --log-level=warning --log-override:import-is-undefined=silent \
    --alias:variant="./bench/variants/$variant.js" --alias:pele="$pele" --alias:blueprint="$blueprint" \
    --alias:gpui-kit=./bench/stubs/gpui-kit.js --alias:gpui-base=./bench/stubs/gpui-base.js \
    --alias:herdr=./bench/stubs/herdr.js --alias:fs/promises=./bench/stubs/fs.js \
    --external:node:fs --external:qjs:std --outfile="$out/$name.js"
}
bundle mv-before mermaid "$upstream/src/index.ts"
bundle mv-after mermaid "$pele/src/index.ts"
bundle blueprint blueprint "$pele/src/index.ts"
node=$(command -v node || true)
${node:-false} bench/cases.mjs "$out/cases.json" >/dev/null || echo "cases.json not written: node is not on PATH" >&2
echo "$out"
