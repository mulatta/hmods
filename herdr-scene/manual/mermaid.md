# Edit and verify a Mermaid diagram

Edit the named `.mmd` or `.mermaid` file, or the indicated `mermaid` fence
in Markdown. Preserve surrounding prose and other diagrams. Use explicit
node or participant IDs where the syntax supports them. Keep those IDs
stable so selection notes can follow the elements across edits.

- Run `hscene parts FILE` to list diagrams, parts, source lines and quotes.
  For a part marked `noted before the diagram changed`, find the current
  definition or match both endpoints and the label. Parallel connections
  can share endpoints. Ask for clarification if several still match.
- Run `hscene parts FILE --near A,B` for the current definitions and
  connections touching A or B, with file line numbers. Pass the source IDs
  used in definitions and endpoints. A node displayed as “Browser” may be
  written as `a[Browser]`, in which case use `--near a`.
- For colors, corners, weights or fonts, run `hscene --skill pele-css`.
  Use a file sidecar for a request about one document. Global CSS affects
  all diagrams, and CSS selectors cannot single out nodes in this parser.

Run `hscene check FILE` on the source machine. Fix the reported Mermaid
lines and CSS declarations. Show the intended diagram, run
`herdr-app shot <path.png>` and inspect the screenshot for clipped labels,
contrast and connections. Use `herdr-app status` to investigate a failed
reload. If a visual check is unavailable, say which checks ran.
