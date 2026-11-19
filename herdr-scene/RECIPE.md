# herdr-mermaid

Review the Mermaid diagrams your agent writes inside Herdr. Pick a box or an
arrow and note what is wrong. The agent gets each note with the exact source
lines it refers to.

## Install

Get `hscene` with `nix profile add github:mulatta/hmods#hscene`, then run
`hscene install`. Or clone <https://github.com/mulatta/hmods> and run
`node herdr-scene/cli/hscene.mjs install` with Node.js 22.18+. For a mod-only
install, copy the share's `mods/mermaid/` into the app home's `mods/`; this
omits `hscene check`, `parts` and the manual. Ask the person before installing
`skills/herdr-scene/` with `hscene install --skill DIR`. Pass `--app-home DIR`
for a different app home. See the
[repository README](https://github.com/mulatta/hmods#install-with-nix) for
details.

## What you see

- A window 62% × 72% of the app, a file picker, then one tab per diagram on a
  pan-and-zoom canvas with select, move, note and pin tools.

## How it behaves

- `cmd-shift-m` (`mod.open:mermaid`) toggles the window for the focused
  terminal; the picker lists `.mmd`, `.mermaid` and Markdown `mermaid` fences.
- Cmd+click or Cmd+drag picks parts; notes stay per part or group. Ask (its
  button or `mermaid.ask`) sends them to the session's agent; `mermaid.ask-now`
  skips the dialog.

## Built from

- `mods/mermaid` plus `vendor/`, an esbuild bundle of this folder's `src/`: a
  fork of pele lays diagrams out as vector scenes that `SceneCanvas` draws.
  It runs `git ls-files`, `git grep` and `hc send` (herdr-core).

## Watch out

- Copy real files, not a link, so Herdr draws the SVG icons.
- To enable the shortcut, merge the share's `keys.json` entry for
  `cmd-shift-m` → `mod.open:mermaid` into the app home's `keys.json`.

## Done when

- Run `herdr-app check <app-home>/mods/mermaid` and confirm it passes.
- `cmd-shift-m` lists the repository's diagrams and the tool icons are visible.
- `cmd-shift-m` lists the repository's diagrams and the tool icons are visible.
