import { test } from "node:test";
import assert from "node:assert/strict";
import { mermaidBlocks, tabsFromFile, askText, partText, sceneLabels } from "../mods/mermaid/sources.js";
import { mermaidScene } from "../src/index.js";

const DOC = `# Auth

Some prose.

## Login flow

\`\`\`mermaid
flowchart LR
  a[Browser] --> b[API]
\`\`\`

\`\`\`js
not a diagram
\`\`\`

~~~mermaid
sequenceDiagram
  A->>B: hi
~~~
`;

test("markdown mermaid fences become blocks with their file line and nearest heading", () => {
  const blocks = mermaidBlocks(DOC);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].src, "flowchart LR\n  a[Browser] --> b[API]\n");
  assert.equal(blocks[0].line, 8); // first line inside the fence, 1-based
  assert.equal(blocks[0].heading, "Login flow");
  assert.equal(blocks[1].src, "sequenceDiagram\n  A->>B: hi\n");
  assert.equal(blocks[1].line, 17);
});

test("a .mmd file is one tab, a .md file one tab per block, named by heading or number", () => {
  assert.deepEqual(tabsFromFile("/x/flow.mmd", "graph TD\n a-->b\n").map((t) => [t.name, t.line0, t.key]),
    [["flow", 0, "/x/flow.mmd#0"]]);
  assert.deepEqual(tabsFromFile("/x/auth.md", DOC).map((t) => [t.name, t.line0]),
    [["auth › Login flow", 7], ["auth #2", 16]]);
  assert.deepEqual(tabsFromFile("/x/none.md", "# nothing\n"), []);
});

test("a part the renderer does not place goes by what it says: no line or name is guessed", () => {
  // "B" is a word of line 3 too, but the renderer did not say where B is written.
  const src = "mindmap\n  root((Plan))\n    a[Plan B]\n    B[Backup]\n";
  const tab = { file: "/x/m.mmd", name: "m", src, line0: 0 };
  assert.equal(partText(tab, { id: "B", kind: "pele-node", label: "Backup" }), 'element "Backup"');
  assert.equal(partText(tab, { id: "L_a_B_0", kind: "pele-edge", label: "" }), "connection L_a_B_0");
});

test("asking about several picks names each one and where it is written", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  const text = askText(tab, [
    { id: "a", kind: "pele-node", label: "Browser", line: 2, symbol: "a" },
    { id: "L_a_b_0", kind: "pele-edge", label: "", line: 2, from: "a", to: "b" },
  ], "Add retries");
  assert.match(text, /\/x\/auth\.md/);
  assert.match(text, /\n- element a "Browser" \(line 9\): a\[Browser\] --> b\[API\]\n- connection a -> b \(line 9\): a\[Browser\] --> b\[API\]\n/);
  assert.match(text, /Add retries/);
  // The agent learns what it cannot see: the diagram is on screen, drawn from the file.
  assert.match(text, /\nI'm viewing this diagram rendered live from the file\. If you change what it describes, update the diagram to match, keeping it valid Mermaid\.$/);
});

test("a remote file's tabs carry its machine in their key", () => {
  const [t] = tabsFromFile("/x/flow.mmd", "graph TD\n a-->b\n", "citra");
  assert.equal(t.machine, "citra");
  assert.equal(t.key, "citra:/x/flow.mmd#0");
  assert.equal(tabsFromFile("/x/flow.mmd", "graph TD\n").at(0).machine, null);
});

test("a Markdown tab knows its block by section, so inserting another block does not move it", () => {
  const ids = (doc) => tabsFromFile("/x/a.md", doc).map((t) => t.block);
  const one = "# A\n```mermaid\ngraph TD\n```\n# B\n```mermaid\npie\n```\n";
  const more = "```mermaid\ngraph LR\n```\n" + one;
  assert.deepEqual(ids(one), ["h:A#0", "h:B#0"]);
  assert.deepEqual(ids(more), ["i:0", "h:A#0", "h:B#0"]);
  assert.equal(tabsFromFile("/x/a.md", one)[1].key, "/x/a.md#h:B#0");
});

test("a file request carries the block range, a comment on the whole, and a quote per part", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  const text = askText(tab, [{ id: "a", kind: "pele-node", label: "Browser", line: 2, symbol: "a", note: "show a spinner" }, { id: "b", kind: "pele-node", label: "API", line: 2, symbol: "b" }], "Keep it small");
  assert.match(text, /^herdr-scene notes \(mermaid\); context: hscene --skill\nMy notes on the Mermaid diagram in \/x\/auth\.md, lines 8-9:\n/);
  assert.doesNotMatch(text, /```mermaid|flowchart LR/);
  assert.match(text, /\nOn the whole: Keep it small\nParts:\n- element a "Browser" \(line 9\): a\[Browser\] --> b\[API\]\n  note: show a spinner\n- element b "API" \(line 9\): a\[Browser\] --> b\[API\]\n/);
  // Only a comment on the whole, or only notes.
  assert.doesNotMatch(askText(tab, [], "Is this complete?"), /Parts:/);
  assert.match(askText(tab, [], "Is this complete?"), /On the whole: Is this complete\?/);
  assert.doesNotMatch(askText(tab, [{ id: "a", kind: "node", label: "", note: "x" }], ""), /On the whole/);
});

test("a part passed to the Ask dialog keeps its kind when its missing ends arrive as null", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  // Herdr hands overlay props over with undefined fields as null.
  const node = { id: "b", kind: "pele-node", role: null, label: "API", line: 2, end: null, symbol: "b", from: null, to: null };
  assert.equal(partText(tab, node), 'element b "API" (line 9)');
  assert.match(askText(tab, [{ ...node, note: "rename" }], ""), /\n- element b "API" \(line 9\): /);
});

test("groups go before single parts as Group 1, 2, …, each with its note and its parts", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  const text = askText(tab, [{ id: "b", kind: "pele-node", label: "API", line: 2, symbol: "b", note: "rename" }], "Whole", [
    { n: 1, text: "merge these", parts: [{ id: "a", kind: "pele-node", label: "Browser", line: 2, symbol: "a" }, { id: "L_a_b_0", kind: "pele-edge", label: "", line: 2, from: "a", to: "b" }] },
  ]);
  assert.match(text, /On the whole: Whole\nGroup 1: merge these\n  - element a "Browser" \(line 9\): a\[Browser\] --> b\[API\]\n  - connection a -> b \(line 9\): a\[Browser\] --> b\[API\]\nParts:\n- element b "API" \(line 9\): a\[Browser\] --> b\[API\]\n  note: rename\n/);
});

test("a request is plain text: no symbols a terminal may draw at another width", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  const text = askText(tab, [{ id: "b", kind: "node", label: "API", note: "x" }], "w", [{ n: 21, text: "g", parts: [{ id: "a", kind: "node", label: "Browser" }] }]);
  assert.match(text, /\nGroup 21: g\n/);
  // Everything but the user's own words and the diagram is ASCII.
  const ours = text.replace(/```mermaid[\s\S]*?```/, "");
  assert.doesNotMatch(ours, /[^\x00-\x7f]/);
  // A diagram that is no file says so, without lines or an update to make.
  const example = askText({ file: null, name: "flow", src: "graph TD\n a-->b\n" }, [], "Is this complete?");
  assert.match(example, /^herdr-scene notes \(mermaid\); context: hscene --skill\nMy notes on the "flow" example Mermaid diagram:\n/);
  assert.match(example, /```mermaid\ngraph TD\n a-->b\n```/);
  assert.doesNotMatch(example, /rendered live/);
});

test("a part is named as the author wrote it: its name or its two ends, its label, its lines in the file", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC); // the block starts after file line 7
  const text = askText(tab, [
    { id: "b", kind: "pele-node pele-shape-rect", label: "API", line: 2, symbol: "b", note: "rename" },
    { id: "L_a_b_0", kind: "pele-edge", label: "", line: 2, from: "a", to: "b" },
    { id: "i3", kind: "pele-edge pele-message", label: "retry 3 times", line: 2, from: "A", to: "B" },
    { id: "subGraph0", kind: "pele-cluster", label: "Two words", line: 1, end: 2 },
    { id: "edge7", kind: "pele-edge pele-transition", label: "" },
  ], "");
  assert.match(text, /\nParts:\n- element b "API" \(line 9\): a\[Browser\] --> b\[API\]\n  note: rename\n- connection a -> b \(line 9\): a\[Browser\] --> b\[API\]\n- connection A -> B "retry 3 times" \(line 9\): a\[Browser\] --> b\[API\]\n- container "Two words" \(lines 8-9\): flowchart LR\n- connection edge7\n/);
});

test("a part noted before the diagram changed says so, with where it was then and nothing quoted", () => {
  const [tab] = tabsFromFile("/x/auth.md", DOC);
  const text = askText(tab, [
    { id: "b", kind: "pele-node", label: "API", line: 2, symbol: "b", note: "now" },
    { id: "L_a_b_0", kind: "pele-edge", label: "go", line: 2, from: "a", to: "b", stale: true, note: "then" },
    { id: "i4", kind: "pele-note", label: "hm", stale: true, note: "gone?" },
  ], "");
  assert.match(text, /\nParts:\n- element b "API" \(line 9\): a\[Browser\] --> b\[API\]\n  note: now\n- connection a -> b "go" \(line 9, noted before the diagram changed\)\n  note: then\n- element "hm" \(noted before the diagram changed\)\n  note: gone\?\n/);
  // A long diagram's parts quote their line, but not one that may hold something else now.
  const long = { file: "/x/big.mmd", name: "big", src: "flowchart TD\n  a --> b\n" + "  %% padding\n".repeat(600), line0: 0 };
  assert.equal(partText(long, { id: "a", kind: "pele-node", label: "A", line: 2, symbol: "a", stale: true }, true), 'element a "A" (line 2, noted before the diagram changed)');
});

test("only fileless examples embed source, regardless of length", () => {
  const src = "flowchart TD\n  a --> b\n" + "  %% padding\n".repeat(600);
  const tab = { file: "/x/big.mmd", name: "big", src, line0: 0 };
  const text = askText(tab, [{ id: "a", kind: "pele-node", label: "A", line: 2, symbol: "a", note: "x" }], "");
  assert.ok(askText({ ...tab, file: null }, [], "").includes(src));
  assert.doesNotMatch(text, /```mermaid/);
  assert.match(text, /^herdr-scene notes \(mermaid\); context: hscene --skill\nMy notes on the Mermaid diagram in \/x\/big\.mmd, lines 1-602:\nParts:\n- element a "A" \(line 2\): a --> b\n  note: x\n/);
});

test("what a part says: its lines of text as one, or the label drawn apart under the same id", () => {
  const span = (text) => [{ text }];
  const scene = {
    items: [
      { id: "stopc", kind: "pele-node" },
      { id: "i0", kind: "pele-edge pele-message" },
      { id: "i0", kind: "pele-edge-label" },
      { id: "x", kind: "pele-node" },
    ],
    texts: [
      { item: 0, spans: span("이 branch rebase 필요") },
      { item: 0, spans: span("보고, 멈춤") },
      { item: 2, spans: span("retry 3 times") },
    ],
  };
  assert.deepEqual(sceneLabels(scene), ["이 branch rebase 필요 보고, 멈춤", "retry 3 times", "retry 3 times", ""]);
});

test("a part with two ends is a connection, whatever its type calls it", () => {
  const tab = { file: "/x/s.mmd", name: "s", src: "sankey-beta\nA,B,5\n", line0: 0 };
  assert.equal(partText(tab, { id: "A->B", kind: "pele-sankey-link", label: "", line: 2, from: "A", to: "B" }), "connection A -> B (line 2)");
});

test("a sequence diagram's loop, alt or rect goes as a container", () => {
  const tab = { file: "/x/s.mmd", name: "s", src: "sequenceDiagram\n  loop every min\n    A->>B: ping\n  end\n", line0: 0 };
  assert.equal(partText(tab, { id: "i0", kind: "pele-frame pele-frame-loop", label: "loop every min", line: 2, end: 4 }), 'container "loop every min" (lines 2-4)');
  assert.equal(partText(tab, { id: "i8", kind: "pele-rect", label: "", line: 2, end: 4 }), "container (lines 2-4)");
});

test("a connection says its label, not a number drawn on it", () => {
  // With autonumber, each message's arrow carries its number; its label is drawn apart.
  const { scene } = mermaidScene("sequenceDiagram\n  autonumber\n  A->>B: hi\n  B-->>A: ok\n");
  const labels = sceneLabels(scene);
  const said = scene.items.flatMap((it, i) => (it.kind.includes("pele-message") ? [labels[i]] : []));
  assert.deepEqual(said, ["hi", "ok"]);
});
