# Pele CSS in the mermaid mod

## Scope and precedence

- Global: `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/pele.css`, read from
  the active app's `appHome()`. Preserve unrelated declarations when editing it.
- Per file: replace the last extension: `diagram.mmd`, `diagram.mermaid`,
  or `diagram.md` uses `diagram.pele.css` beside it, not `diagram.mmd.pele.css`.
  These names share that sidecar if they are in the same directory. All Mermaid
  blocks in one Markdown file share its sidecar. A remote sidecar lives beside
  the source on that remote machine; global CSS belongs to the app host.
- Host theme → global CSS → file CSS. A diagram's own supported series palette
  then overrides those series colors. Explicit element paints can override theme
  colors too; inspect the diagram before diagnosing an ignored CSS color.

The parser collects custom-property declarations; selectors are not matched.
Use `:root` for clarity. `.special { --pele-accent: red; }` does not scope red to
special nodes. `@media (prefers-color-scheme: dark)` and its light counterpart
select appearance; other media rules and general CSS cascade behavior are not
implemented. A later declaration wins; do not rely on `!important` precedence.

## A file-specific theme

```css
:root {
  --brand: #4385be;
  --pele-bg: #101010;
  --pele-fg: #eeeeee;
  --pele-accent: var(--brand);
  --pele-surface: color-mix(in srgb, var(--brand) 15%, #101010);
  --pele-border: #606060;
  --pele-series-1: #e78284;
  --pele-series-2: #a6d189;
  --pele-radius: 6px;
  --pele-bold-weight: 600;
  --pele-font: Inter, sans-serif;
}

@media (prefers-color-scheme: light) {
  :root {
    --pele-bg: #ffffff;
    --pele-fg: #202020;
    --pele-surface: #edf3f8;
  }
}
```

Other paint variables: `--pele-muted`, `--pele-line`, `--pele-surface-alt`,
`--pele-series-1` through `--pele-series-8`. Text weights also include
`--pele-title-weight` and `--pele-heading-weight`; monospace uses
`--pele-font-mono`. Font names must be available to the host; CSS does not
install fonts. Check label placement after changing a font or weight.

Accepted value families:

- Colors: hex, named colors, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()`.
  Examples: `hsl(120 100% 25%)`, `oklch(0.55 0.15 255)`.
- `color-mix(in srgb|srgb-linear|oklab|oklch, color [percent], color [percent])`.
  This is a limited parser, not full CSS Color syntax. For portability use hex;
  do not assume relative colors, `calc()`, or hue interpolation modifiers work.
- `var(--name, fallback)` can use custom properties declared in these files,
  including names without `pele-`, or the host theme's `--pele-*` values.
  Only resolved `--pele-*` outputs affect rendering. Avoid cyclic references.
- Radius: nonnegative number or `px`. Weights: `normal`, `bold`, integers 1–1000.
  Fonts: a family name or comma-separated family list.

Invalid final values are omitted; they do not restore an earlier declaration.
Out-of-gamut OKLCH colors are clipped by sRGB channel and can differ from a
browser's gamut mapping. CSS-file `color-mix()` is evaluated; the separate
scene paint resolver still approximates some embedded mix expressions using
only their first color. Do not claim every diagram paint matches browser CSS.

## Diagram-local styling

For an individual element, use the diagram type's supported Mermaid styling
statements, such as flowchart `style` or `classDef`, and verify the result.
Do not write `.pele-node { fill: red }`: general selector rules are ignored.

Frontmatter `config.themeVariables` supports series palettes: `pie1..pie8`,
`git0..git7`, `cScale0..cScale7` for timeline/radar/treemap,
`cScale1..cScale8` for mindmap, `venn1..venn8`, and
`xyChart.plotColorPalette` for xychart. Those palette colors are diagram-local.
Mermaid's built-in `theme: dark/forest/...` and general `themeVariables` colors
such as `primaryColor` are not equivalent to setting pele CSS variables.
