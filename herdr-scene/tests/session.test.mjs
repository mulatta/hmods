import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRef, refKey, SceneCache, sceneBytes, matches, pruneSessions } from "../mods/mermaid/session.js";

test("file references name a machine before a colon, or none for this one", () => {
  assert.deepEqual(parseRef("/x/a.md"), { machine: null, path: "/x/a.md" });
  assert.deepEqual(parseRef("citra:/x/a.md"), { machine: "citra", path: "/x/a.md" });
  // The session's machine applies to a bare path; an explicit one wins.
  assert.deepEqual(parseRef("  /x/a.md ", "psi"), { machine: "psi", path: "/x/a.md" });
  assert.deepEqual(parseRef("citra:/x", "psi"), { machine: "citra", path: "/x" });
  assert.equal(parseRef("relative/a.md"), null);
  assert.equal(refKey({ machine: "citra", path: "/x" }), "citra:/x");
  assert.equal(refKey({ machine: null, path: "/x" }), "/x");
});

test("the scene cache answers only for the same source and drops the oldest past its limit", () => {
  const scene = (cmds) => ({ shapes: [{ cmds: Array.from({ length: cmds }, () => [1, 0, 0]).flat() }], texts: [], items: [] });
  const one = sceneBytes(scene(100));
  const c = new SceneCache(one * 2.5);
  c.set("a", "src a", { scene: scene(100) });
  c.set("b", "src b", { scene: scene(100) });
  assert.ok(c.get("a", "src a"));
  assert.equal(c.get("a", "changed"), null);
  // "a" was used last, so "b" goes when "c" comes.
  c.set("c", "src c", { scene: scene(100) });
  assert.equal(c.get("b", "src b"), null);
  assert.ok(c.get("a", "src a") && c.get("c", "src c"));
  assert.ok(c.bytes <= one * 2.5);
});

test("a filter matches a substring or letters in order, any case; an empty one matches all", () => {
  assert.ok(matches("docs/auth/Login.md", "login"));
  assert.ok(matches("src/lo/gin.mmd", "login"));
  assert.ok(matches("anything", " "));
  assert.equal(matches("other.md", "login"), false);
});

test("sessions of terminals that are gone are dropped after a grace period", () => {
  const now = 1_000_000;
  const all = { t1: { at: now - 10 }, t2: { at: now - 10 }, t3: { at: now - 999_999 } };
  assert.deepEqual(Object.keys(pruneSessions(all, new Set(["t1"]), now, 100_000)), ["t1", "t2"]);
});

test("tabs: pinned first in pin order, then the saved order, then new ones as found", async () => {
  const { orderTabs, moveKey } = await import("../mods/mermaid/session.js");
  const tabs = ["a", "b", "c", "d", "e"].map((key) => ({ key }));
  assert.deepEqual(orderTabs(tabs, ["d", "gone"], ["c", "a"]).map((t) => t.key), ["d", "c", "a", "b", "e"]);
  assert.deepEqual(moveKey(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveKey(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveKey(["a", "b"], "a", "zzz"), ["a", "b"]);
});

test("grep output names each mermaid block of a file by its section and its type", async () => {
  const { mdBlocksFromGrep, typesFromGrep } = await import("../mods/mermaid/session.js");
  // grep -n -Z -A1 for headings and mermaid fences: file NUL line:match, line-context.
  const out = [
    "/r/a.md\u00001:# Auth", "/r/a.md\u00002-", "--",
    "/r/a.md\u00005:## Login", "/r/a.md\u00006-", "--",
    "/r/a.md\u00007:```mermaid", "/r/a.md\u00008-flowchart LR", "--",
    "/r/a.md\u000012:~~~mermaid", "/r/a.md\u000013-  sequenceDiagram", "--",
    "/r/b.md\u00003:```mermaid", "/r/b.md\u00004-%% a comment", "",
  ].join("\n");
  const blocks = mdBlocksFromGrep(out);
  assert.deepEqual(blocks.get("/r/a.md"), [
    { id: "h:Login#0", heading: "Login", line: 8, type: "flowchart", index: 0 },
    { id: "h:Login#1", heading: "Login", line: 13, type: "sequence", index: 1 },
  ]);
  assert.deepEqual(blocks.get("/r/b.md"), [{ id: "i:0", heading: null, line: 4, type: null, index: 0 }]);
  const types = typesFromGrep("/r/x.mmd\u00003:stateDiagram-v2\n/r/y.mermaid\u00001:graph TD\n");
  assert.deepEqual([...types], [["/r/x.mmd", "state"], ["/r/y.mermaid", "flowchart"]]);
});

test("the picker tree groups items by the first folder under the path, files at the top level last", async () => {
  const { pickerTree } = await import("../mods/mermaid/session.js");
  const blocks = new Map([["/r/docs/a.md", [{ id: "i:0", heading: null, line: 3, type: "flowchart", index: 0 }]], ["/r/README.md", []]]);
  const t = pickerTree("/r", ["/r/docs/a.md", "/r/.mermaid/x.mmd", "/r/top.mmd", "/r/README.md"], blocks, new Map([["/r/top.mmd", "pie"]]));
  assert.deepEqual(t.groups.map((g) => [g.name, g.items.map((i) => i.rel)]), [[".mermaid", ["x.mmd"]], ["docs", ["a.md"]]]);
  // A Markdown file with no mermaid block is not an item.
  assert.deepEqual(t.items.map((i) => [i.rel, i.type]), [["top.mmd", "pie"]]);
  assert.equal(t.groups[1].items[0].blocks.length, 1);
});

test("notes are kept per session and tab: one per part, one per group of parts", async () => {
  const { setNote, setGroupNote, notesFor, clearNotes } = await import("../mods/mermaid/session.js");
  let all = setNote({}, "t1", "k", "api", "rate-limit here");
  all = setNote(all, "t1", "k", "db", "index it");
  all = setGroupNote(all, "t1", "k", ["b", "a"], "merge these");
  all = setGroupNote(all, "t1", "k", ["c", "d"], "split");
  all = setNote(all, "t2", "k", "api", "other session");
  assert.deepEqual(notesFor(all, "t1", "k"), {
    items: { api: "rate-limit here", db: "index it" },
    groups: [{ ids: ["a", "b"], text: "merge these" }, { ids: ["c", "d"], text: "split" }],
  });
  // The same parts in any order are the same group; blank removes.
  all = setGroupNote(all, "t1", "k", ["a", "b"], "merge them");
  assert.equal(notesFor(all, "t1", "k").groups[0].text, "merge them");
  all = setGroupNote(all, "t1", "k", ["a", "b"], " ");
  all = setNote(all, "t1", "k", "api", "");
  assert.deepEqual(notesFor(all, "t1", "k"), { items: { db: "index it" }, groups: [{ ids: ["c", "d"], text: "split" }] });
  all = clearNotes(all, "t1", "k");
  assert.deepEqual(all, { t2: { k: { items: { api: "other session" }, groups: [] } } });
  assert.deepEqual(notesFor(all, "t9", "x"), { items: {}, groups: [] });
});

test("a path may start at the home folder of its machine, and is shown that way", async () => {
  const { parseRef, tildePath } = await import("../mods/mermaid/session.js");
  const homes = { "": "/Users/me", citra: "/home/me" };
  assert.deepEqual(parseRef("~/docs", null, homes), { machine: null, path: "/Users/me/docs" });
  assert.deepEqual(parseRef("~", null, homes), { machine: null, path: "/Users/me" });
  assert.deepEqual(parseRef("citra:~/x.md", null, homes), { machine: "citra", path: "/home/me/x.md" });
  assert.deepEqual(parseRef("~/a", "citra", homes), { machine: "citra", path: "/home/me/a" });
  // A home not known yet: not a path.
  assert.equal(parseRef("psi:~/a", null, homes), null);
  assert.equal(tildePath("/Users/me/docs/a.md", "/Users/me"), "~/docs/a.md");
  assert.equal(tildePath("/Users/me", "/Users/me"), "~");
  assert.equal(tildePath("/Users/meow/a", "/Users/me"), "/Users/meow/a");
  assert.equal(tildePath("/x", null), "/x");
});

// A diagram's parts as the view takes them: each scene item with what it says.
const partsOf = async (src) => {
  const { mermaidScene } = await import("../src/index.js");
  const { sceneLabels } = await import("../mods/mermaid/sources.js");
  const { scene } = mermaidScene(src);
  const labels = sceneLabels(scene);
  return scene.items.map((it, i) => ({ ...it, label: labels[i] }));
};

test("while the text is the same, a note is on the part it was made on, even one just like another", async () => {
  const { noteKey, partIndex, resolveNotes, diagramVersion } = await import("../mods/mermaid/session.js");
  const src = "flowchart TD\n  c --> d; c --> d\n";
  const parts = await partsOf(src), v = diagramVersion(src);
  const edges = parts.flatMap((p, i) => (p.kind === "pele-edge" ? [i] : []));
  // Both run c -> d on line 2, with no label: still two parts.
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map((i) => partIndex(parts, i)), edges);
  const key = noteKey(parts[edges[1]], v);
  assert.notEqual(key, noteKey(parts[edges[0]], v));
  const r = resolveNotes({ items: { [key]: "the second" }, groups: [] }, parts, v);
  assert.deepEqual([...r.items], [[edges[1], "the second"]]);
  assert.deepEqual(r.stale, []);
});

test("once the text changes, a part is found by a name of its own; any other note is kept as noted", async () => {
  const { noteKey, partIndex, resolveNotes, diagramVersion } = await import("../mods/mermaid/session.js");
  const before = "sequenceDiagram\n  participant A\n  A->>B: hi\n  Note over A: first\n  Note over B: second\n";
  // A note is added above the others: drawn ids and lines shift.
  const after = "sequenceDiagram\n  participant A\n  A->>B: hi\n  Note over A: zero\n  Note over A: first\n  Note over B: second\n";
  const at = (parts, pred) => partIndex(parts, parts.findIndex(pred));
  const p0 = await partsOf(before), v0 = diagramVersion(before);
  const alice = noteKey(p0[at(p0, (p) => p.symbol === "A")], v0);
  const hi = noteKey(p0[at(p0, (p) => p.from && p.label === "hi")], v0);
  const second = noteKey(p0[at(p0, (p) => p.label === "second")], v0);
  const p1 = await partsOf(after), v1 = diagramVersion(after);
  assert.notEqual(v1, v0);
  const r = resolveNotes({ items: { [second]: "n2", [alice]: "n1", [hi]: "n3" }, groups: [{ ids: [alice, hi], text: "g" }] }, p1, v1);
  // The participant has a name of its own.
  const a1 = at(p1, (p) => p.symbol === "A");
  assert.deepEqual([...r.items], [[a1, "n1"]]);
  // A note or a message has none: it is kept as it was noted, and never put on
  // another part ("second" was the drawn id the note "first" has now).
  assert.deepEqual(r.stale.map((s) => [s.label, s.line, s.note, s.stale]), [["second", 5, "n2", true], ["hi", 3, "n3", true]]);
  assert.equal(r.stale[0].key, second);
  assert.deepEqual(r.groups.map((g) => [g.n, g.text, g.items, g.stale.map((s) => s.label)]), [[1, "g", [a1], ["hi"]]]);
});

test("a name several parts share, or one no part has any more, finds none once the text changes", async () => {
  const { noteKey, locate } = await import("../mods/mermaid/session.js");
  const parts = [
    { id: "root_start", kind: "pele-node pele-state-start", line: 2, symbol: "[*]", label: "" },
    { id: "root_end", kind: "pele-node pele-state-end", line: 3, symbol: "[*]", label: "" },
    { id: "A", kind: "pele-node pele-state", line: 2, symbol: "A", label: "A" },
  ];
  const end = noteKey(parts[1], "v1"), a = noteKey(parts[2], "v1");
  assert.equal(locate(parts, end, "v1"), 1);
  assert.equal(locate(parts, end, "v2"), -1);
  assert.equal(locate(parts, a, "v2"), 2);
  assert.equal(locate(parts.filter((p) => p.id !== "A"), a, "v2"), -1);
  assert.equal(locate(parts, "not a key", "v1"), -1);
});

test("notes kept as noted can be dropped, from a group too; a group left with none goes", async () => {
  const { setNote, setGroupNote, notesFor, dropNotes } = await import("../mods/mermaid/session.js");
  let all = setNote({}, "s", "k", "x", "one");
  all = setNote(all, "s", "k", "y", "two");
  all = setGroupNote(all, "s", "k", ["x", "z"], "both");
  all = setGroupNote(all, "s", "k", ["w"], "alone");
  all = dropNotes(all, "s", "k", ["x", "w"]);
  assert.deepEqual(notesFor(all, "s", "k"), { items: { y: "two" }, groups: [{ ids: ["z"], text: "both" }] });
});

test("a note saved again where its part now is replaces the old one in place", async () => {
  const { setNote, setGroupNote, notesFor } = await import("../mods/mermaid/session.js");
  let all = setGroupNote({}, "s", "k", ["a@1", "b@1"], "first");
  all = setGroupNote(all, "s", "k", ["c@1", "d@1"], "second");
  // The parts moved down a line: the group keeps its place, so its number.
  all = setGroupNote(all, "s", "k", ["a@2", "b@2"], "first, edited", ["a@1", "b@1"]);
  assert.deepEqual(notesFor(all, "s", "k").groups, [{ ids: ["a@2", "b@2"], text: "first, edited" }, { ids: ["c@1", "d@1"], text: "second" }]);
  all = setNote(all, "s", "k", "x@1", "note");
  all = setNote(all, "s", "k", "x@3", "note, edited", "x@1");
  assert.deepEqual(notesFor(all, "s", "k").items, { "x@3": "note, edited" });
});

test("a label or title drawn apart is the part it belongs to", async () => {
  const { partIndex } = await import("../mods/mermaid/session.js");
  const parts = [
    { id: "grp", kind: "pele-cluster-title", label: "Group" },
    { id: "grp", kind: "pele-cluster", line: 9, end: 11, symbol: "grp", label: "Group" },
    { id: "i0", kind: "pele-edge pele-message", line: 4, from: "A", to: "B", label: "retry" },
    { id: "i0", kind: "pele-edge-label", label: "retry" },
    { id: "A", kind: "pele-actor-footer pele-node", line: 2, symbol: "A", label: "Alice" },
    { id: "A", kind: "pele-activation", label: "" },
    { id: "A", kind: "pele-node pele-actor", line: 2, symbol: "A", label: "Alice" },
    { id: "Dogs", kind: "pele-legend-item", line: 3, symbol: "Dogs", label: "Dogs" },
    { id: "Dogs", kind: "pele-slice", line: 3, symbol: "Dogs", label: "42%" },
  ];
  // A participant's bottom box and activation bars are its box at the top; a legend entry is what it stands for.
  assert.deepEqual(parts.map((_, i) => partIndex(parts, i)), [1, 1, 2, 2, 6, 6, 6, 8, 8]);
});

test("a block whose text is unchanged follows its text when one is added or taken out before it", async () => {
  const { movedBlocks } = await import("../mods/mermaid/session.js");
  const { tabsFromFile } = await import("../mods/mermaid/sources.js");
  const block = (body) => "```mermaid\n" + body + "\n```\n";
  const doc = (...bodies) => "# A\n" + bodies.map(block).join("");
  const tabs = (...bodies) => tabsFromFile("/x/a.md", doc(...bodies));
  const moves = (before, after) => Object.fromEntries([...movedBlocks(before, after)].map(([a, b]) => [a.replace(/^.*#h:/, ""), b.replace(/^.*#h:/, "")]));
  const x = "graph TD\n a-->b", y = "pie\n \"A\" : 1", z = "graph LR\n c-->d";
  // A block added first in the section: the others move down.
  assert.deepEqual(moves(tabs(x, y), tabs(z, x, y)), { "A#0": "A#1", "A#1": "A#2" });
  // One taken out: the next moves up.
  assert.deepEqual(moves(tabs(x, y), tabs(y)), { "A#1": "A#0" });
  // In place, or changed as well as moved: nothing to follow.
  assert.deepEqual(moves(tabs(x, y), tabs(x, y, z)), {});
  assert.deepEqual(moves(tabs(x), tabs(z, x + "\n e-->f")), {});
  // A text that is not one block's alone could be either.
  assert.deepEqual(moves(tabs(x), tabs(z, x, x)), {});
  // Only the blocks shown before count: a file shown in part.
  assert.deepEqual(moves(tabs(x, y).slice(1), tabs(z, x, y)), { "A#1": "A#2" });
});

test("what is kept under a moved key goes with it, and what was under its new key gives way", async () => {
  const { moveKeys } = await import("../mods/mermaid/session.js");
  const moved = new Map([["k0", "k1"], ["k1", "k2"]]);
  assert.deepEqual(moveKeys({ k0: "x", k1: "y", other: "z" }, moved), { k1: "x", k2: "y", other: "z" });
  // A block taken out: the one after it moves onto its key.
  assert.deepEqual(moveKeys({ k0: "gone", k1: "y" }, new Map([["k1", "k0"]])), { k0: "y" });
  assert.deepEqual(moveKeys(undefined, moved), {});
});

test("a participant created and destroyed is still its box, with its line and name", async () => {
  const { partIndex } = await import("../mods/mermaid/session.js");
  const parts = await partsOf("sequenceDiagram\n  participant A\n  create participant B\n  A->>B: hi\n  destroy B\n  A-xB: bye\n");
  const b = new Set(parts.flatMap((p, i) => (p.id === "B" ? [partIndex(parts, i)] : [])));
  assert.equal(b.size, 1);
  const [at] = b;
  assert.equal(parts[at].kind.includes("pele-actor"), true);
  assert.deepEqual([parts[at].line, parts[at].symbol], [3, "B"]);
});
