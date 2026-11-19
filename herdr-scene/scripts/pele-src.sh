#!/usr/bin/env bash
# Prints the source directory used by both the benchmark and the mod build.
set -euo pipefail
if [[ -n ${PELE_SRC:-} ]]; then
  cd "$PELE_SRC"
  pwd
  exit
fi

root=$(cd "$(dirname "$0")/.." && pwd)
rev=$(node -p 'require(process.argv[1]).rev' "$root/pele.json")
cache=${XDG_CACHE_HOME:-$HOME/.cache}/hmods
src=$cache/pele-$rev
if [[ ! -d $src ]]; then
  mkdir -p "$cache"
  tmp=$(mktemp -d "$cache/.pele-XXXXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  git -C "$tmp" init -q
  git -C "$tmp" fetch -q --depth 1 https://github.com/mulatta/pele.git "$rev"
  git -C "$tmp" checkout -q --detach "$rev"
  # Publish the complete checkout atomically, including when another build wins.
  node -e 'try { require("node:fs").renameSync(...process.argv.slice(1)) } catch (e) { if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e }' "$tmp" "$src"
fi
cd "$src"
pwd
