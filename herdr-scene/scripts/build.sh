#!/usr/bin/env bash
# Bundles the pele fork and the mermaid mod's dependencies for distribution.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/mods/mermaid/vendor"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$root"

# Keep in step with nixpkgs' esbuild, so a plain clone builds what Nix builds.
esbuild_version=0.27.2
found=$(command esbuild --version 2>/dev/null || true)
if [[ $found == "$esbuild_version" ]]; then
  esbuild() { command esbuild "$@"; }
elif [[ -n ${NIX_BUILD_TOP+x} ]]; then
  echo "esbuild ${found:-not found} on PATH, $esbuild_version pinned in build.sh" >&2
  exit 1
elif command -v npx >/dev/null 2>&1; then
  esbuild() { npx --yes "esbuild@$esbuild_version" "$@"; }
else
  echo "esbuild $esbuild_version not found: install Node.js (for npx) or run inside 'nix develop'" >&2
  exit 1
fi

pele=$(bash scripts/pele-src.sh)
mkdir -p build
# A stable module path keeps chunk hashes independent of the store or cache path.
ln -sfn "$pele" build/pele
# pele as one ES module, for tests and for the mods.
esbuild build/pele/src/index.ts --bundle --format=esm --target=es2022 --minify --log-level=warning --outfile=build/pele.js

rm -rf "$out/chunks"
esbuild herdr-scene=scripts/mod-entry.js --bundle --splitting --format=esm --target=es2022 --minify --log-level=warning \
  --preserve-symlinks --alias:pele-lazy=./build/pele/src/lazy.ts \
  --external:gpui-kit --external:gpui-base --external:herdr --external:fs/promises \
  '--chunk-names=chunks/[name]-[hash]' --outdir="$out"

esbuild cli/hscene.mjs --bundle --platform=node --format=esm --target=node22 --log-level=warning --outfile=build/hscene.mjs
