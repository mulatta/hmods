// Where diagrams come from and how they are described to an agent. Plain
// JavaScript with no Herdr imports, so tests run it under Node.

const base = (path) => path.replace(/^.*\//, "");

/** A Markdown heading line's text, or null. */
export const headingOf = (line) => line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/)?.[1] ?? null;

/**
 * Names a file's mermaid blocks in order, steadily: by the section (nearest
 * heading) and the count within it, so a block added elsewhere in the file
 * leaves the others' names alone; blocks before any heading go by position.
 */
export function blockNamer() {
  const seen = new Map();
  let index = 0;
  return (section) => {
    const n = seen.get(section) ?? 0;
    seen.set(section, n + 1);
    return section ? `h:${section}#${n}` : `i:${index++}`;
  };
}

/**
 * The ```mermaid (or ~~~mermaid) fences in a Markdown text.
 * `line` is the 1-based file line of the block's first line; `heading` the
 * nearest heading above it, if no earlier block already took that heading;
 * `id` names the block steadily (blockNamer).
 * @returns {{ src: string, line: number, heading: string | null, id: string }[]}
 */
export function mermaidBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  const name = blockNamer();
  let heading = null, section = null;
  for (let i = 0; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (h !== null) {
      heading = section = h;
      continue;
    }
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})([^\r\n]*)\r?$/);
    if (!open || (open[2][0] === "`" && open[3].includes("`"))) continue;
    const isDiagram = open[3].trim() === "mermaid";
    const close = new RegExp(`^\\s*${open[2][0]}{${open[2].length},}\\s*$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (close.test(lines[j])) break;
      if (isDiagram) body.push(lines[j].slice(Math.min(open[1].length, lines[j].length - lines[j].trimStart().length)));
    }
    if (isDiagram) {
      out.push({ src: body.join("\n") + "\n", line: i + 2, heading, id: name(section) });
      heading = null;
    }
    i = j;
  }
  return out;
}

/**
 * The tabs one file shows: a .mmd file is one diagram, a Markdown file one
 * per mermaid block. `line0` is how many file lines come before the diagram.
 * `machine` is where the file is (null: this one).
 */
export function tabsFromFile(file, text, machine = null) {
  const name = base(file).replace(/\.(mmd|mermaid|md|markdown)$/i, "");
  const at = `${machine ? `${machine}:` : ""}${file}`;
  if (!/\.(md|markdown)$/i.test(file)) return [{ name, file, machine, src: text, line0: 0, block: null, key: `${at}#0` }];
  const blocks = mermaidBlocks(text);
  return blocks.map((b, i) => ({
    name: blocks.length === 1 ? name : b.heading ? `${name} › ${b.heading}` : `${name} #${i + 1}`,
    file,
    machine,
    src: b.src,
    line0: b.line - 1,
    block: b.id,
    key: `${at}#${b.id}`,
  }));
}

/** Whether a folder entry is a diagram source this view reads. */
export const isSource = (name) => /\.(mmd|mermaid|md|markdown)$/i.test(name);

const isLink = (kind) => kind.includes("edge") || kind.includes("message");
// What holds other parts: a subgraph, a box, a sequence diagram's loop, alt or rect.
const isGroup = (kind) => /cluster|pele-frame|(^|\s)pele-rect(\s|$)/.test(kind);
// What a part is. Pele's scene says (`role`); a part read from SVG is told by its class names. A
// label drawn apart is named by what it labels.
export const roleOf = (p) =>
  p.role && p.role !== "label" ? p.role : isLink(p.kind) || p.from != null ? "connection" : isGroup(p.kind) ? "container" : "element";

// A label longer than this is cut short where a part is named.
const LABEL_MAX = 100;

/**
 * What each item says on the diagram, by item index: its lines of text as
 * one, else the text of a label drawn apart under the same id (an edge's or a
 * message's). A connection with a label drawn apart says that label, not
 * what is drawn on its line: a sequence diagram's autonumber puts each
 * message's number there.
 */
export function sceneLabels(scene) {
  const own = scene.items.map(() => []);
  for (const t of scene.texts) if (t.item >= 0) own[t.item].push(t.spans.map((s) => s.text).join(""));
  const joined = own.map((lines) => {
    const s = lines.join(" ").replace(/\s+/g, " ").trim();
    return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s;
  });
  const apart = new Map();
  scene.items.forEach((it, i) => {
    if (it.id && joined[i] && it.kind.includes("label") && !apart.has(it.id)) apart.set(it.id, joined[i]);
  });
  return scene.items.map((it, i) => {
    const drawn = it.id ? apart.get(it.id) : undefined;
    return (roleOf(it) === "connection" && it.role !== "label" && !it.kind.includes("label") && drawn) || joined[i] || drawn || "";
  });
}

/**
 * A part as a request names it: what it is, its name as written (or its two
 * ends), its label, its lines in the file, and with `quote` the text of its
 * first line. The name, ends and lines are what the renderer records (by the
 * diagram's own lines); a type it records nothing for is named by its label
 * alone, as nothing else would be more than a guess, and a part with no label
 * either keeps the renderer's id. A part `stale`, noted before the diagram
 * changed, says so: its lines are where it was then, so none is quoted.
 */
export function partText(tab, p, quote = false) {
  const at = tab.line0 ?? 0;
  const line = p.line != null ? at + p.line : 0, end = p.end != null ? at + p.end : 0;
  const kind = roleOf(p);
  const name = p.from != null && p.to != null ? `${p.from} -> ${p.to}` : p.symbol;
  const label = p.label && p.label !== name ? `"${p.label}"` : "";
  const span = line ? (end && end !== line ? `lines ${line}-${end}` : `line ${line}`) : "";
  const where = p.stale ? `(${span ? `${span}, ` : ""}noted before the diagram changed)` : span ? `(${span})` : "";
  const head = [kind, name ?? (label || span ? "" : p.id), label, where].filter(Boolean).join(" ");
  const text = quote && line && !p.stale ? tab.src.split("\n")[line - 1 - at]?.trim() : "";
  return text ? `${head}: ${text}` : head;
}

/**
 * The request sent to an agent, as the person's own message: the diagram (its
 * lines, and its source for a fileless example), `whole` as a comment on all of it,
 * `groups` (notes on several parts together, numbered as the view labels
 * them) and the picked parts, each with its own note if it has one. The notes
 * say what is wanted; the request adds only what the agent cannot see: that
 * the diagram is on screen, drawn from its file. Plain ASCII around the
 * person's words, since it is typed into a terminal, where symbols such as
 * circled digits or arrows may take one column or two.
 * A part noted before the diagram changed (`stale`) goes as it was noted.
 * @param {{ file: string | null, name: string, src: string, line0?: number }} tab
 * @param {{ id: string, kind: string, label: string, note?: string, stale?: boolean }[]} picks
 * @param {{ n: number, text: string, parts: { id: string, kind: string, label: string, stale?: boolean }[] }[]} [groups]
 */
export function askText(tab, picks, whole, groups = []) {
  const describe = (p) => {
    const head = `- ${partText(tab, p, true)}`;
    return p.note?.trim() ? `${head}\n  note: ${p.note.trim()}` : head;
  };
  const first = (tab.line0 ?? 0) + 1, last = (tab.line0 ?? 0) + tab.src.replace(/\n$/, "").split("\n").length;
  return [
    "herdr-scene notes (mermaid); context: hscene --skill",
    tab.file ? `My notes on the Mermaid diagram in ${tab.file}, lines ${first}-${last}:` : `My notes on the "${tab.name}" example Mermaid diagram:`,
    !tab.file ? `\`\`\`mermaid\n${tab.src.replace(/\n$/, "")}\n\`\`\`` : "",
    whole?.trim() ? `On the whole: ${whole.trim()}` : "",
    ...groups.map((g) => [`Group ${g.n}: ${g.text.trim()}`, ...g.parts.map((p) => `  ${describe(p)}`)].join("\n")),
    picks.length ? ["Parts:", ...picks.map(describe)].join("\n") : "",
    tab.file ? "I'm viewing this diagram rendered live from the file. If you change what it describes, update the diagram to match, keeping it valid Mermaid." : "",
  ].filter(Boolean).join("\n");
}
