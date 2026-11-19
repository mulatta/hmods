// Per-agent sessions, the scene cache and the file picker's candidates. Plain
// JavaScript with no Herdr imports, so tests run it under Node.

import { blockNamer, headingOf } from "./sources.js";

/** @typedef {{ machine: string | null, path: string }} Ref  a file, on a machine (null: this one) */

/**
 * "citra:/abs/doc.md", "/abs/doc.md" (on `machine`) or the same from "~", the
 * home folder of that machine as `homes` knows it (key "" for this one) -> a
 * Ref; null unless absolute or from a known home.
 */
export function parseRef(text, machine = null, homes = {}) {
  let s = String(text ?? "").trim();
  const m = s.match(/^([\w.-]+):([/~].*)$/);
  if (m) [machine, s] = [m[1], m[2]];
  if (s === "~" || s.startsWith("~/")) {
    const home = homes[machine ?? ""];
    if (!home) return null;
    s = home.replace(/\/$/, "") + s.slice(1);
  }
  return s.startsWith("/") ? { machine, path: s } : null;
}

/** `path` with its home folder written as "~". */
export function tildePath(path, home) {
  if (!home) return path;
  const h = home.replace(/\/$/, "");
  return path === h ? "~" : path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

export const refKey = (r) => `${r.machine ? `${r.machine}:` : ""}${r.path}`;

/** Roughly what a scene holds in the heap, from QuickJS measurements (~16 B a path number). */
export function sceneBytes(scene) {
  let cmds = 0;
  for (const s of scene?.shapes ?? []) cmds += s.cmds.length;
  return 16 * cmds + 300 * (scene?.texts?.length ?? 0) + 200 * (scene?.items?.length ?? 0) + 1024;
}

/**
 * Laid-out diagrams by tab key, valid for one source text, least recently used
 * dropped past `limit` bytes. It lives at module scope, where Herdr keeps it
 * across copies of the same build (a window closed and opened again), so it
 * must hold plain results only, never a view.
 */
export class SceneCache {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map(); // key -> { src, value, bytes }, oldest first
    this.bytes = 0;
  }

  get(key, src) {
    const e = this.map.get(key);
    if (!e || e.src !== src) return null;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key, src, value) {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.map.delete(key);
    }
    const bytes = sceneBytes(value?.scene);
    this.map.set(key, { src, value, bytes });
    this.bytes += bytes;
    for (const [k, e] of this.map) {
      if (this.bytes <= this.limit || k === key) break;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }
}

/** Whether `text` matches a typed filter: a substring or its letters in order, any case. */
export function matches(text, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  const s = String(text).toLowerCase();
  if (s.includes(q)) return true;
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

/** Sessions whose terminal is live, or that were used within `graceMs`. */
export function pruneSessions(all, live, now, graceMs) {
  const out = {};
  for (const [id, s] of Object.entries(all ?? {})) if (live.has(id) || now - (s?.at ?? 0) < graceMs) out[id] = s;
  return out;
}

/** Tabs in the order shown: pinned ones first in pin order, then the saved order, then the rest as found. */
export function orderTabs(tabs, pins = [], order = []) {
  const rank = new Map();
  pins.forEach((k, i) => rank.set(k, i));
  order.forEach((k, i) => { if (!rank.has(k)) rank.set(k, pins.length + i); });
  const last = pins.length + order.length;
  return tabs.map((t, i) => [t, rank.get(t.key) ?? last + i]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

/** `list` with `from` moved to where `to` is; unchanged if either is missing. */
export function moveKey(list, from, to) {
  const i = list.indexOf(from), j = list.indexOf(to);
  if (i < 0 || j < 0 || i === j) return list;
  const out = list.slice();
  out.splice(i, 1);
  out.splice(j, 0, from);
  return out;
}

const TYPES = [
  [/^(flowchart|graph)\b/, "flowchart"], [/^sequenceDiagram\b/, "sequence"], [/^classDiagram/, "class"],
  [/^stateDiagram/, "state"], [/^erDiagram\b/, "er"], [/^requirementDiagram\b/, "requirement"],
  [/^(C4\w+)\b/, null], [/^(gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|xychart|sankey|block|packet|kanban|architecture|radar|treemap)\b/, null],
];

/** The diagram type a source line declares (a short name), or null. */
export function diagramType(line) {
  const s = String(line ?? "").trim();
  for (const [re, name] of TYPES) {
    const m = s.match(re);
    if (m) return name ?? m[1];
  }
  return null;
}

// `grep -n -Z` output: "file NUL line:text" for a match, "file NUL line-text"
// for a context line, "--" between groups.
function grepRecords(out) {
  const recs = [];
  for (const row of String(out ?? "").split("\n")) {
    const z = row.indexOf("\0");
    if (z < 0) continue;
    const m = row.slice(z + 1).match(/^(\d+)([:-])(.*)$/);
    if (m) recs.push({ file: row.slice(0, z), line: Number(m[1]), match: m[2] === ":", text: m[3] });
  }
  return recs;
}

/**
 * Each Markdown file's mermaid blocks from `grep -n -Z -A1` over heading and
 * mermaid-fence lines: id (as sources.js names it), section heading, the
 * block's first line, and its type from that line.
 * @returns {Map<string, { id: string, heading: string | null, line: number, type: string | null, index: number }[]>}
 */
export function mdBlocksFromGrep(out) {
  const recs = grepRecords(out);
  const at = new Map(recs.map((r) => [`${r.file}\0${r.line}`, r.text]));
  const files = new Map();
  for (const r of recs) {
    if (!r.match) continue;
    let f = files.get(r.file);
    if (!f) files.set(r.file, (f = { section: null, name: blockNamer(), blocks: [] }));
    const h = headingOf(r.text);
    if (h !== null) {
      f.section = h;
      continue;
    }
    if (!/^\s*(`{3,}|~{3,})\s*mermaid\s*$/.test(r.text)) continue;
    const line = r.line + 1;
    f.blocks.push({ id: f.name(f.section), heading: f.section, line, type: diagramType(at.get(`${r.file}\0${line}`)), index: f.blocks.length });
  }
  return new Map([...files].map(([k, f]) => [k, f.blocks]));
}

/** Each diagram file's type, from `grep -n -Z -m1` over type lines. */
export function typesFromGrep(out) {
  const types = new Map();
  for (const r of grepRecords(out)) if (r.match && !types.has(r.file)) types.set(r.file, diagramType(r.text));
  return types;
}

/**
 * What the picker lists under `dir`: diagram files and Markdown files with
 * mermaid blocks, grouped by the first folder below `dir` (by name), with
 * the files right in `dir` apart. Each item's `rel` is from its group.
 */
export function pickerTree(dir, files, blocksByFile, typesByFile) {
  const root = dir.replace(/\/$/, "");
  const groups = new Map(), items = [];
  for (const path of [...files].sort((a, b) => a.localeCompare(b))) {
    if (!path.startsWith(`${root}/`)) continue;
    const md = /\.(md|markdown)$/i.test(path);
    const blocks = md ? blocksByFile.get(path) ?? [] : null;
    if (md && !blocks.length) continue;
    const rel = path.slice(root.length + 1);
    const cut = rel.indexOf("/");
    const item = { path, rel: cut < 0 ? rel : rel.slice(cut + 1), md, type: md ? null : typesByFile.get(path) ?? null, blocks };
    if (cut < 0) items.push(item);
    else {
      const name = rel.slice(0, cut);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
  }
  return {
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => ({ name, path: `${root}/${name}`, items: list })),
    items,
  };
}

// --- blocks that move ---------------------------------------------------------
//
// A Markdown file's blocks are named by their section and their count in it
// (see blockNamer), so a block added or taken out before another in its
// section renames that one. What the session keeps under a tab's key (its
// pin, place, view, the choice of blocks, its notes) follows the block when
// its text is unchanged and found under one key only; otherwise there is no
// telling which block it is.

/** Old tab key -> new, for blocks shown `before` ({ key, src }) whose text is now under exactly one other key `after`. */
export function movedBlocks(before, after) {
  const moved = new Map();
  for (const b of before) {
    if (b.src == null || after.some((a) => a.key === b.key && a.src === b.src)) continue;
    const same = after.filter((a) => a.src === b.src);
    if (same.length === 1 && before.filter((o) => o.src === b.src).length === 1) moved.set(b.key, same[0].key);
  }
  return moved;
}

/** `obj` keyed by tab keys, with `moved` applied: an entry goes with its key; one under a key another moved onto gives way. */
export function moveKeys(obj, moved) {
  const out = {};
  const onto = new Set(moved.values());
  for (const [k, v] of Object.entries(obj ?? {})) if (!moved.has(k) && !onto.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(obj ?? {})) if (moved.has(k)) out[moved.get(k)] = v;
  return out;
}

// One tab's notes as stored: { items: id -> text, groups: [{ ids (sorted), text }] }.
function tabNotes(raw) {
  return { items: { ...(raw?.items ?? {}) }, groups: [...(raw?.groups ?? [])] };
}

// All sessions' notes with one tab's notes changed by `edit`; a tab left with none is dropped.
function editNotes(all, session, tabKey, edit) {
  const out = { ...(all ?? {}) };
  const tabs = { ...(out[session] ?? {}) };
  const notes = edit(tabNotes(tabs[tabKey]));
  if (Object.keys(notes.items).length || notes.groups.length) tabs[tabKey] = notes;
  else delete tabs[tabKey];
  if (Object.keys(tabs).length) out[session] = tabs;
  else delete out[session];
  return out;
}

const clean = (text) => String(text ?? "").trim();

/**
 * All sessions' notes with one part's note set, under `key`; blank text
 * removes it. `was`: the key it was kept under, when the part has moved.
 */
export function setNote(all, session, tabKey, key, text, was = key) {
  return editNotes(all, session, tabKey, (n) => {
    delete n.items[was];
    if (clean(text)) n.items[key] = clean(text);
    else delete n.items[key];
    return n;
  });
}

/**
 * All sessions' notes with the note on a group of parts (in any order) set;
 * blank text removes it. `was`: the group's keys before its parts moved; it
 * keeps its place, and so its number.
 */
export function setGroupNote(all, session, tabKey, ids, text, was = ids) {
  const key = [...new Set(ids)].sort();
  const old = [...new Set(was)].sort();
  const same = (g) => g.ids.length === old.length && g.ids.every((id, i) => id === old[i]);
  return editNotes(all, session, tabKey, (n) => {
    const i = n.groups.findIndex(same);
    if (!clean(text)) {
      if (i >= 0) n.groups.splice(i, 1);
    } else if (i >= 0) n.groups[i] = { ids: key, text: clean(text) };
    else n.groups.push({ ids: key, text: clean(text) });
    return n;
  });
}

/** All sessions' notes without any for one tab of one session. */
export const clearNotes = (all, session, tabKey) => editNotes(all, session, tabKey, () => ({ items: {}, groups: [] }));

/** All sessions' notes with one tab's notes under `keys` dropped, also from its groups; a group left with no part goes. */
export function dropNotes(all, session, tabKey, keys) {
  const out = new Set(keys);
  return editNotes(all, session, tabKey, (n) => {
    for (const key of out) delete n.items[key];
    n.groups = n.groups.map((g) => ({ ...g, ids: g.ids.filter((key) => !out.has(key)) })).filter((g) => g.ids.length);
    return n;
  });
}

/** One tab's notes in a session: { items: key -> text, groups: [{ keys as ids, text }] }. */
export const notesFor = (all, session, tabKey) => tabNotes(all?.[session]?.[tabKey]);

// --- which part a note is on ---------------------------------------------------
//
// A note is kept for the diagram as drawn when it was made: the version of its
// text (diagramVersion), the part's drawn id, and the part as the author wrote
// it (noteKey). While the text is the same, the drawing is too, and the note
// is on that part. Once the text changes, drawn ids shift; a part with a name
// of its own that no other part has (a node, a participant, a class) is still
// that name. Any other part (a connection, a note, a part of a type whose
// names are not recorded, a name such as [*] that several parts share) can no
// longer be told for certain, so its note is kept as noted: not on the
// drawing, and sent as noted before the diagram changed. A part is a scene
// item with its label (see sceneLabels).

/** A short fingerprint of a diagram's text, telling versions apart. */
export function diagramVersion(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
}

// Items drawn under one id are one part, shown on the one in front: one that
// says where it is written, and not a participant's lifeline, bottom box,
// activation bar or the cross that ends it, nor a legend entry, nor a label
// or title drawn apart.
const apart = /label|title/;
const behind = (p) => (p.line === undefined ? 2 : 0) + (/lifeline|footer|activation|destroy|legend/.test(p.kind) ? 1 : 0);

// For each parts list, once: the part of each drawn id, and the parts each name is on.
const indexes = new WeakMap();
function indexOf(parts) {
  let x = indexes.get(parts);
  if (x) return x;
  const byId = new Map(), byName = new Map();
  parts.forEach((p, i) => {
    if (!p.id || apart.test(p.kind)) return;
    const j = byId.get(p.id);
    if (j === undefined || behind(p) < behind(parts[j])) byId.set(p.id, i);
  });
  parts.forEach((p, i) => {
    const at = p.id ? byId.get(p.id) ?? i : -1;
    if (p.symbol === undefined || at < 0) return;
    if (!byName.has(p.symbol)) byName.set(p.symbol, new Set());
    byName.get(p.symbol).add(at);
  });
  x = { byId, byName };
  indexes.set(parts, x);
  return x;
}

/** The part drawn item `i` is (an index into `parts`), or -1 for an item with no id. */
export function partIndex(parts, i) {
  const id = parts[i]?.id;
  return id ? indexOf(parts).byId.get(id) ?? i : -1;
}

/** The key a note on part `p` is kept under, in the diagram drawn from text of version `v`. */
export const noteKey = (p, v) =>
  JSON.stringify({ v, id: p.id, kind: p.kind, label: p.label, line: p.line, end: p.end, symbol: p.symbol, from: p.from, to: p.to });

// What a note key holds, or null for a key of no version.
function parseKey(key) {
  try {
    const k = JSON.parse(key);
    return k && typeof k === "object" && "v" in k ? k : null;
  } catch {
    return null;
  }
}

// The index of the part a note key (as parsed) is on, or -1.
function place(parts, k, v) {
  const { byId, byName } = indexOf(parts);
  if (k.v === v) {
    const i = byId.get(k.id);
    if (i !== undefined && parts[i].kind === k.kind) return i;
  }
  const named = k.symbol === undefined ? null : byName.get(k.symbol);
  return named?.size === 1 ? [...named][0] : -1;
}

/** The index of the part a note key is on in the diagram drawn from text of version `v`, or -1. */
export function locate(parts, key, v) {
  const k = parseKey(key);
  return k ? place(parts, k, v) : -1;
}

// A note's part as it was noted, for a note kept as noted: its key goes with it.
const asNoted = ({ v: _, ...part }, key) => ({ ...part, stale: true, key });

/** Part indices in the order they are written: by line, then as drawn. */
export const byLine = (parts, list) => [...list].sort((a, b) => (parts[a].line ?? Infinity) - (parts[b].line ?? Infinity) || a - b);

/**
 * A tab's notes on the diagram drawn from text of version `v`: those on its
 * parts (part index -> text); the groups, numbered as they were made, each
 * with the parts it is on (in the order written) and the parts kept as noted;
 * and the single notes kept as noted (see asNoted), each with its `note`.
 * @returns {{ items: Map<number, string>, groups: { n: number, text: string, items: number[], stale: object[] }[], stale: object[] }}
 */
export function resolveNotes(notes, parts, v) {
  const items = new Map(), stale = [];
  for (const [key, text] of Object.entries(notes.items)) {
    const k = parseKey(key);
    if (!k) continue;
    const i = place(parts, k, v);
    if (i >= 0 && !items.has(i)) items.set(i, text);
    else stale.push({ ...asNoted(k, key), note: text });
  }
  const groups = [];
  notes.groups.forEach((g, n) => {
    const placed = new Set(), old = [];
    for (const key of g.ids) {
      const k = parseKey(key);
      if (!k) continue;
      const i = place(parts, k, v);
      if (i >= 0) placed.add(i);
      else old.push(asNoted(k, key));
    }
    if (placed.size || old.length) groups.push({ n: n + 1, text: g.text, items: byLine(parts, placed), stale: old });
  });
  return { items, groups, stale };
}
