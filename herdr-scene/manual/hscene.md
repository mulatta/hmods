# hscene manual (herdr-scene)

## Read a request from Ask

The mermaid mod sends a message beginning with this line:

```text
herdr-scene notes (mermaid); context: hscene --skill
```

Read the file path, diagram range and quoted lines first. A fileless example
includes its Mermaid source. Answer questions directly. For edits, apply
`On the whole` to the diagram, `Group N` to its listed parts together, and
each indented `note:` to the part above it. Match the quoted lines to their
source ID or connection endpoints.

Treat `noted before the diagram changed` as a description of the old drawing.
Run `hscene parts FILE` to find the part in the current file. Match both
endpoints and the label for an edge. If several still match, ask the person
which one they meant before editing. Read `hscene --skill mermaid` for editing
and verification.

Select enables box selection. Esc returns to Move. Double-click a part or
use the memo button to record a note. Ask can combine group, part and whole
diagram notes. Use `mermaid.ask` to review the recipient and message.
`mermaid.ask-now` can send immediately. Both are for making a request:
use `hscene check` and a screenshot to verify an edit.

## Find and show a diagram

Read `herdr-app --skill` and the relevant sections of
`${HERDR_APP_HOME:-$HOME/.config/herdr-app}/AGENTS.md`. Identify the
intended terminal, pane and open mod with `herdr-app ls` and `herdr-app status`.

- **Window.** Focus the intended terminal, then run
  `herdr-app do mod.open --name mermaid` if the window is closed.
  The command toggles the window. Its file list and view belong to the
  terminal focused when it opens. Reopening from that terminal restores them.
- **Pane.** To show known files beside a terminal, inspect `herdr-app commands`
  and use the actual target pane ID:

  ```sh
  herdr-app do pane.split '{"pane":"<target-pane-id>","direction":"right","mod":"mermaid","props":{"files":["/absolute/path/diagram.mmd"]}}'
  ```

  Explicit files give this view its own file list. Notes are keyed by the
  file list. The target pane ID chooses where to split.

- **Sidebar.** Add a block node with `"content":{"mod":"mermaid"}` to a
  layout column, about 400 px wide or more so the toolbar fits. It accepts
  `content.props.files` like a pane. With no explicit files, the mod takes
  its session from the terminal focused when the layout loads and keeps that
  owner across focus changes.
- **Not a layout `floating` block.** Those size to their content, and the
  canvas has no size of its own, so it collapses to its toolbar. For a
  floating view, use the window above: it is a movable overlay whose
  position Herdr remembers.

In every placement, Ask first looks for an agent at the terminal address
captured when the view initialized, including views with explicit files.
If none matches, Ask uses the agent with the latest sequence number in
the currently focused tab, then the latest agent anywhere. With no agent,
it reports “No agent to ask.” Check the name in the Ask dialog.

Use Files to select a local path or `machine:/absolute/path`. For Markdown,
select individual blocks or the whole file to include blocks added later.
Use the picker to add a file to the window. Herdr has no documented
`mermaid.open-file` command. Local sources and CSS sidecars are watched.
Remote files and their sidecars are polled every 2.5 seconds. For remote
file operations, read `hc --skill` and use `hc file ... --on <machine>`.

Run these on the intended active copy:

```sh
herdr-app do mermaid.files
herdr-app do mermaid.fit
herdr-app do mermaid.actual
herdr-app do mermaid.select
herdr-app do mermaid.move
```

## Topics

| Topic | When | Command |
| --- | --- | --- |
| mermaid | Locate parts, edit source and verify the drawing | `hscene --skill mermaid` |
| pele-css | Choose a sidecar, theme variable or diagram-local style | `hscene --skill pele-css` |
