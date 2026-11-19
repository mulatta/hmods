# herdr-meter

Shows when each agent's prompt cache expires, so you can send the next
prompt before it does. Also shows how close Claude and Codex are to their
rate limits.

## Install

From the checkout, install `hmeter` with `nix profile add .#hmeter` or
`cargo install --locked --path herdr-meter`. Then run `hmeter install`
to copy both mods into the app home. Run it again after upgrading the binary
so open mods reload in place.

## What you see

- cache: the shipped agent list; an idle or done agent's ring is peach after a
  turn, cools through yellow to blue, blinks in its last tenth, gray once expired.
- usage: one row per Claude and Codex window: percent used and time to reset.

## How it behaves

- cache's tooltip has the figures and a notification goes out before a large
  cache expires; usage refreshes every ten minutes.

## Built from

- `mods/cache` is a clone of the shipped `agents` mod; it and `mods/usage` run
  `hmeter` (this folder's Rust crate) with `exec`. Icons come from `workspace-chrome`.

## Watch out

- `hmeter` learns about caches only from agent hooks: Claude Code's status line
  wrapped as `hmeter ingest claude -- <script>`, Codex's `PostModelRequest`
  hook into `hmeter ingest codex`; terminals must come from herdr-core.
- cache and usage are `place: "none"`: a layout block names them, cache in
  place of `agents`.

## Done when

- `herdr-app check` passes for `mods/cache` and `mods/usage`.
- After an agent turn, `hmeter list` shows the terminal and its ring is colored;
  after `hmeter usage --refresh`, usage shows Claude and Codex rows.
