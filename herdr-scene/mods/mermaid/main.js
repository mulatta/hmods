// Mermaid view: every Mermaid diagram type drawn natively, beside an agent,
// and picked nodes, edges or messages handed to that agent with a request.
//
// It opens as a window over the tab (`herdr-app do mod.open:mermaid`,
// bound to a key), so the terminals keep their size. Each terminal it is
// opened from has its own session: the diagrams it shows, their order and
// pins, the tab and the view of each, kept in shared state, so closing and
// opening again (or a restart) picks up where it was.
//
// Files picks what to show: a path (the terminal's repository at first, on
// its machine too), and under it every .mmd/.mermaid file and every mermaid
// block of a Markdown file, grouped by folder, to check. A Markdown file
// checked whole also shows blocks added to it later, and a block that moves
// when another is added before it keeps its tab and notes. Shown diagrams are
// redrawn when saved; files on another machine are read again every few
// seconds. As a pane, props `{ "files": ["/abs/doc.md", "citra:/abs/x.mmd"] }`
// show those instead, without a session; `{ "above": true }` with a downward
// split puts the pane above.
//
// Tabs: drag one onto another to move it, its pin keeps it at the front, ✕
// closes it; closing the last closes the window, as ✕ at the top right does.
//
// Move (the hand) pans with a drag; Select draws a box that picks, and Esc
// goes back to Move. Scroll pans, Cmd/Ctrl+scroll or -/+ zooms, a click
// picks; Cmd/Shift adds, Option removes. The note button (✎) or a double
// click notes the picks: one part gets its own note, several a note on them
// together (a group, labelled on the diagram G1, G2, …); a double click on a
// part that is not picked notes that part alone. Notes stay with the session
// until asked. When the diagram changes, a note on a part with a name of its
// own follows that name; any other is kept as it was noted, off the drawing,
// and Ask shows it before it goes. Ask (at the bottom, or `herdr-app do
// mermaid.ask`) sends the groups, the noted parts and the other picks,
// each with its note, and a request for all of them, to the session's agent;
// with none, the request is about the whole diagram.
//
// Commands: tab-<n>, next, fit, actual (100% from the top-left corner),
// zoom-in, zoom-out, zoom-reset, select, move, clear, note, ask, ask-now (sends
// the notes without the dialog, unless one was made before the diagram
// changed), files, measure.
//
// Colors follow the Herdr theme. ~/.config/herdr-app/pele.css (Herdr's home) sets pele's
// --pele-* CSS variables over it, as on a web page: `:root { --pele-accent: #205ea6;
// --pele-radius: 6px; --pele-bold-weight: 600; --pele-font: Inter; }`, and under
// `@media (prefers-color-scheme: dark)` for one appearance only. A file's own
// <name>.pele.css beside it (doc.pele.css for doc.md) goes over that for its diagrams.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, settings, props, panes, spaces, terminals, run, openOverlay, closeOverlay, appHome, watchFolder, readTextFile, exec, nextCommand, agents, focused, hc, notify, shared, setShared } from "herdr";
import * as fs from "fs/promises";
import { SceneCanvas, mermaidScene, peleCss, prepare, themeVars } from "./vendor/herdr-scene.js";
import { askText, partText, sceneLabels, tabsFromFile } from "./sources.js";
import { parseRef, refKey, tildePath, SceneCache, matches, pruneSessions, orderTabs, moveKey, mdBlocksFromGrep, typesFromGrep, pickerTree, setNote, setGroupNote, clearNotes, dropNotes, notesFor, noteKey, locate, partIndex, resolveNotes, byLine, diagramVersion, movedBlocks, moveKeys } from "./session.js";

const MOD = "mermaid";
// Pele CSS for every diagram, in Herdr's home: --pele-* variables, as a page
// with pele's stylesheet would set them (see peleCss).
const PELE_CSS = "pele.css";
const SESSIONS = "mermaid.sessions";
// Notes on diagram parts, written by the note and ask dialogs (other copies of
// this mod), read by the view: session -> tab key -> item id -> text.
const NOTES = "mermaid.notes";
const icon = (name) => svg(`mods/${MOD}/icons/${name}.svg`).size(14).flex_none();
// A session whose terminal is gone is kept this long, in case it comes back.
const SESSION_GRACE_MS = 7 * 24 * 3600 * 1000;
// Changes reach shared state (which re-renders every mod) this long after the last.
const SAVE_MS = 800;
// How often files on another machine are read again: there is no watching there.
const REMOTE_POLL_MS = 2500;
// The picker looks this deep under its path, past these folders, and lists at most this many rows.
const SCAN_DEPTH = "6";
const SCAN_SKIP = ["(", "-name", ".git", "-o", "-name", "node_modules", ")", "-prune", "-o"];
const ROWS_MAX = 400;
const HEADINGS_AND_FENCES = "^(#{1,6}[[:space:]]|[[:space:]]*(```|~~~)[[:space:]]*mermaid[[:space:]]*$)";
const DIAGRAM_TYPES = "^[[:space:]]*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|requirementDiagram|C4[A-Za-z]+|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|xychart|sankey|block|packet|kanban|architecture|radar|treemap)";

// One look for every screen (diagram, picker, dialogs): bar height, padding,
// gaps, corner radius, text sizes and control heights.
const UI = { bar: 44, pad: 12, gap: 8, radius: 6, title: 13, text: 12.5, small: 11, input: 30, slot: 64, mainSlot: 78 };

// A bar along the top or bottom of a screen.
const bar = (t, edge) => h_flex().h(UI.bar).flex_none().px(UI.pad).gap(UI.gap).items_center().border_color(t.border)
  .map((e) => (edge === "top" ? e.border_b_1() : e.border_t_1()));

// Every button: plain, active (a mode that is on) or strong (the main action).
// `width` fixes it, so buttons that take each other's place between screens line up.
function button(t, id, label, on, { enabled = true, active = false, strong = false, tip = null, tight = false, width = null } = {}) {
  const solid = strong && enabled;
  return div().id(id).px(tight ? 7 : 10).py(4).rounded(UI.radius).flex_none().text_size(UI.text)
    .when(width !== null, (e) => e.w(width).flex().justify_center())
    .bg(solid ? t.solid : active ? t.selected : t.surface)
    .text_color(solid ? t.solid_foreground : active ? t.foreground : enabled ? t.muted : t.dim)
    .when(!!tip, (e) => e.tooltip(tip))
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(solid ? t.solid : active ? t.selected : t.hover)).on_click((_e, cx) => { on(cx); cx.notify(); }))
    .child(label);
}

const field = (t, state, focused = false) => Input.new(state).w_full().h(UI.input).px(8).rounded(UI.radius).border(1).border_color(focused ? t.accent : t.input);

// Laid-out diagrams outlive a closed window: a copy opened again finds them
// here. They live in memory only, in the window's script heap. The cache hangs
// off globalThis, replaced whenever a new build of this mod loads: Herdr never
// frees an old build's module, so a cache held in a module constant would stay
// with every build ever loaded.
const CACHE = Symbol.for(`${MOD}.scene-cache`);
globalThis[CACHE] = new SceneCache(32 * 1024 * 1024);
const cache = () => globalThis[CACHE];

const now = () => Date.now();
// Longer than Herdr lets a task slice run (500 ms), with room for a slow machine.
const STOPPED_MS = 3000;

// Sends a request (see askRequest) with `whole` as the comment on all of it to
// its agent, and forgets the notes it carried; false when there is nothing to
// ask: no comment and no note.
function deliver(ask, whole, cx) {
  const { tab, picks, groups, agent, session, tabKey } = ask;
  if (!whole && !groups.length && !picks.some((p) => p.note)) return false;
  const text = askText(tab, picks, whole, groups);
  setShared(NOTES, clearNotes(shared(NOTES), session, tabKey));
  cx.spawn(async () => {
    try {
      const r = await hc(["send", agent.address, text]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc send ${r.code}`).trim());
      notify({ title: `Asked ${agent.name}`, body: whole || groups[0]?.text || picks.find((p) => p.note)?.note || tab.name, level: "success", timeout: 4000 });
    } catch (e) {
      notify({ title: "Could not send", body: String(e?.message ?? e), level: "error" });
    }
  });
  return true;
}
// Whether a request has a part noted before the diagram changed.
const staleIn = (ask) => ask.picks.some((p) => p.stale) || ask.groups.some((g) => g.parts.some((p) => p.stale));
const dirOf = (path) => path.replace(/\/[^/]*$/, "") || "/";
// A diagram file's own pele CSS: doc.pele.css for doc.md.
const cssOf = (path) => path.replace(/(\/[^/]*?)(\.[^./]*)?$/, "$1.pele.css");
const sameView = (a, b) => (!a && !b) || (a && b && a.z === b.z && a.x === b.x && a.y === b.y);
const fileKeyOf = (tab) => refKey({ machine: tab.machine, path: tab.file });

// The terminal the view was opened from, which owns its session.
function opener() {
  const f = focused();
  const id = f?.terminal ?? null;
  const agent = id ? agents().find((a) => a.address === id) : null;
  const pane = id ? panes().find((p) => p.terminal === id) : null;
  const space = spaces().find((s) => s.id === f?.space);
  return {
    id,
    name: agent ? agent.app ?? agent.title : pane?.title ?? id ?? "this window",
    machine: space?.machine ?? null,
    cwd: pane?.cwd ?? f?.cwd ?? null,
  };
}

export default class MermaidView extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // The same mod opened as the Ask dialog: a pane that was not clicked does
    // not get the keyboard, a dialog does.
    if (p.ask) return this.initAsk(p, cx);
    if (p.note) return this.initNote(p, cx);
    // pane.split only goes right or down: `{ "above": true }` moves the new
    // pane, which has the focus right after the split, over the one it split.
    if (p.above) {
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        const me = panes().find((q) => q.focused && q.mod === MOD);
        if (me) run("pane.swap", { pane: me.pane, direction: "up" });
      });
    }
    this.overlay = p.overlay ?? null; // set when opened as a window
    this.homes = {}; // machine ("" for this one) -> its home folder, for "~" in paths
    this.owner = opener();
    const given = [...(p.files ?? []), ...(p.file ? [p.file] : [])].map((f) => parseRef(f, null)).filter(Boolean);
    // A pane given files shows those; a window keeps a session for its terminal.
    this.sessionId = given.length ? null : this.owner.id ?? "window";
    const saved = this.sessionId ? shared(SESSIONS)?.[this.sessionId] : null;
    this.session = {
      // { machine, path, blocks }: blocks null shows a Markdown file's every block, else those ids.
      files: (given.length ? given : saved?.files ?? []).map((r) => ({ machine: r.machine ?? null, path: r.path, blocks: r.blocks ?? null })),
      tab: saved?.tab ?? null,
      views: { ...(saved?.views ?? {}) },
      order: saved?.order ?? [],
      pins: saved?.pins ?? [],
    };
    this.tabs = [];
    this.tab = 0;
    this.texts = new Map(); // file key -> text (null: unreadable)
    this.fileCss = new Map(); // file key -> its own pele CSS ("" without one)
    this.results = new Map(); // tab key -> { src, scene, type, ms, error, cached }
    this.computing = null; // { at, tab } while laying out (see compute)
    this.picks = []; // picked scene items, in the order picked
    this.partsOf = null; // { scene, parts }: the shown scene's items with their labels
    this.pressedTab = null; // a tab pressed, to drop on another
    this.watchGen = 0;
    this.focus = cx.focus_handle();
    this.canvas = new SceneCanvas({
      id: `${MOD}-canvas`,
      onPick: (items, cx) => {
        this.picks = items;
        cx.notify();
      },
      onOpen: (_item, _cx, items) => this.openNote(items),
      onPress: () => this.focus.focus(),
    });
    this.peleCss = { text: "", key: null, vars: {} };
    this.watchPeleCss(cx);
    this.query = InputState.new({ placeholder: "Filter" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.query.on("submit", (_e, cx) => this.applyPicker(cx));
    this.pathBar = InputState.new({ placeholder: "~/folder, /absolute/folder or machine:~/folder" });
    // Cmd+Enter shows what is checked from either field; Enter in the path goes there.
    this.pathBar.on("submit", (e, cx) => (e.secondary ? this.applyPicker(cx) : this.goTo(cx, this.pathBar.value())));
    this.picker = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const m = c.match(/^tab-(\d+)$/);
        if (m) this.select(Number(m[1]));
        else if (c === "next") this.select((this.tab + 1) % Math.max(1, this.tabs.length));
        else if (c === "fit") this.canvas.fit();
        else if (c === "zoom-in") this.canvas.zoomBy(1.25);
        else if (c === "zoom-out") this.canvas.zoomBy(0.8);
        else if (c === "zoom-reset") this.canvas.zoomTo(1);
        else if (c === "select") this.canvas.selecting = true;
        else if (c === "move") this.canvas.selecting = false;
        else if (c === "clear") this.clearPicks();
        else if (c === "note") this.openNote(this.picks);
        else if (c === "ask") this.openAsk();
        else if (c === "ask-now") this.askNow(cx);
        else if (c === "files") this.openPicker(cx);
        else if (c === "measure") await this.measure(cx);
        else if (c === "actual") this.canvas.view = { z: 1, x: 0, y: 0 };
        else continue;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      await this.load(cx);
      if (!this.session.files.length) this.openPicker(cx);
      this.watch(cx);
      await this.knowHome(this.owner.machine);
      cx.notify();
    });
  }

  // Learns a machine's home folder once, so paths can be written from "~".
  // Callers at the same time wait on the same lookup.
  knowHome(machine) {
    const key = machine ?? "";
    this.homeLookups ??= {};
    this.homeLookups[key] ??= (async () => {
      try {
        const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine, timeout: 5000 });
        if (r.code === 0 && r.stdout.startsWith("/")) this.homes[key] = r.stdout;
      } catch {}
    })();
    return this.homeLookups[key];
  }

  // A path as people write it: on its machine, from "~" when under its home.
  shortPath(machine, path) {
    return `${machine ? `${machine}:` : ""}${tildePath(path, this.homes[machine ?? ""])}`;
  }

  close() {
    this.flush();
  }

  // --- files and session ---------------------------------------------------

  // Local folders are watched; files on other machines are read again now and
  // then. A new set of files starts new watchers; the old ones stop.
  watch(cx) {
    const gen = ++this.watchGen;
    const dirs = new Set(this.session.files.filter((r) => !r.machine).map((r) => dirOf(r.path)));
    for (const dir of dirs) {
      cx.spawn(async (cx) => {
        for (;;) {
          try {
            await watchFolder(dir);
          } catch {
            return;
          }
          if (gen !== this.watchGen) return;
          await this.load(cx);
        }
      });
    }
    if (this.session.files.some((r) => r.machine)) {
      cx.spawn(async (cx) => {
        for (;;) {
          await cx.sleep(REMOTE_POLL_MS);
          if (gen !== this.watchGen) return;
          await this.load(cx);
        }
      });
    }
  }

  // pele.css is read at the start and again whenever Herdr's home changes.
  watchPeleCss(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let text = "";
        try {
          text = await readTextFile(`${appHome()}/${PELE_CSS}`);
        } catch {}
        if (text !== this.peleCss.text) {
          this.peleCss = { text, key: null, vars: {} };
          cx.notify();
        }
        try {
          await watchFolder(appHome());
        } catch {
          return;
        }
      }
    });
  }

  // The variables pele.css, then the tab's file's own, set for the appearance
  // and theme now; read again only when one of those changes.
  peleVars(tab) {
    const dark = !!settings()?.dark, base = themeVars(theme());
    const own = (tab && this.fileCss.get(fileKeyOf(tab))) || "";
    const key = [dark, own, ...Object.values(base)];
    const c = this.peleCss;
    if (!c.key || key.some((v, i) => v !== c.key[i])) this.peleCss = { ...c, key, vars: peleCss([c.text, own], dark, base) };
    return this.peleCss.vars;
  }

  async load(cx, { force = false } = {}) {
    // All at once: a file on another machine costs a round trip, and each has its CSS to read too.
    const read = async (path, on, none) => {
      try {
        return await readTextFile(path, { on });
      } catch {
        return none;
      }
    };
    const files = this.session.files;
    const [bodies, sheets] = await Promise.all([
      Promise.all(files.map((r) => read(r.path, r.machine, null))),
      Promise.all(files.map((r) => read(cssOf(r.path), r.machine, ""))),
    ]);
    const texts = new Map(files.map((r, i) => [refKey(r), bodies[i]]));
    const css = new Map(files.map((r, i) => [refKey(r), sheets[i]]));
    // A file's pele CSS changes its paints, not its drawing.
    if ([...css].some(([k, v]) => this.fileCss.get(k) !== v)) {
      this.fileCss = css;
      cx.notify();
    }
    const same = texts.size === this.texts.size && [...texts].every(([k, v]) => this.texts.get(k) === v);
    if (same && !force && this.tabs.length) return;
    this.texts = texts;
    this.layoutTabs(cx);
  }

  // Blocks that moved in their file, one added or taken out before them in
  // their section, keep what the session holds under their key: pin, place,
  // view, choice and notes, and their drawing (see movedBlocks). Old key -> new.
  followBlocks() {
    const moved = new Map();
    for (const r of this.session.files) {
      const text = this.texts.get(refKey(r));
      if (text == null) continue;
      const shown = this.tabs.filter((t) => fileKeyOf(t) === refKey(r));
      for (const [from, to] of movedBlocks(shown, tabsFromFile(r.path, text, r.machine))) moved.set(from, to);
    }
    if (!moved.size) return moved;
    const keys = (list) => [...new Set(list.map((k) => moved.get(k) ?? k))];
    const s = this.session;
    s.pins = keys(s.pins);
    s.order = keys(s.order);
    s.views = moveKeys(s.views, moved);
    if (s.tab) s.tab = moved.get(s.tab) ?? s.tab;
    s.files = s.files.map((r) => {
      const at = `${refKey(r)}#`;
      return r.blocks ? { ...r, blocks: keys(r.blocks.map((b) => at + b)).map((k) => k.slice(at.length)) } : r;
    });
    const notes = shared(NOTES) ?? {}, mine = notes[this.noteSession()];
    if (mine) setShared(NOTES, { ...notes, [this.noteSession()]: moveKeys(mine, moved) });
    this.results = new Map(Object.entries(moveKeys(Object.fromEntries(this.results), moved)));
    if (this.shownKey) this.shownKey = moved.get(this.shownKey) ?? this.shownKey;
    return moved;
  }

  // The tabs the session's files and picks make now, in the session's order.
  layoutTabs(cx) {
    const moved = this.followBlocks();
    const before = this.tabs[this.tab];
    const all = this.session.files.flatMap((r) => {
      const text = this.texts.get(refKey(r));
      if (text == null) return [{ name: r.path.replace(/^.*\//, ""), file: r.path, machine: r.machine, src: null, line0: 0, block: null, key: `${refKey(r)}#missing` }];
      const tabs = tabsFromFile(r.path, text, r.machine);
      return r.blocks ? tabs.filter((t) => r.blocks.includes(t.block)) : tabs;
    });
    const next = orderTabs(all, this.session.pins, this.session.order);
    // A diagram that changed is what someone is working on: show it.
    const changed = next.find((t) => t.src != null && this.results.has(t.key) && this.results.get(t.key).src !== t.src);
    this.tabs = next;
    // A diagram no longer shown keeps no scene here.
    const live = new Set(next.map((t) => t.key));
    for (const k of this.results.keys()) if (!live.has(k)) this.results.delete(k);
    const shown = before && (moved.get(before.key) ?? before.key);
    const keep = shown ? next.findIndex((t) => t.key === shown) : next.findIndex((t) => t.key === this.session.tab);
    this.select(changed ? next.indexOf(changed) : Math.max(0, keep), { keepPick: !changed && keep >= 0 && !!before });
    if (moved.size) this.saveSoon(cx);
    cx.notify();
    this.compute(cx);
  }

  select(i, { keepPick = false } = {}) {
    if (i < 0 || i >= this.tabs.length) return;
    const same = i === this.tab;
    this.tab = i;
    this.session.tab = this.tabs[i].key;
    if (!keepPick || !same) this.clearPicks();
    this.show();
  }

  // Puts the current tab's scene on the canvas, if it is ready: a new drawing
  // of the tab shown keeps its view, another tab gets the one it was left at.
  show() {
    const tab = this.tabs[this.tab];
    const r = tab && this.results.get(tab.key);
    if (r?.scene && this.canvas.scene !== r.scene) {
      const same = this.shownKey === tab.key;
      // Picks are indices into the old scene.
      this.canvas.set(r.scene, { keepView: same });
      if (!same) this.canvas.view = this.session.views[tab.key] ?? null;
      this.shownKey = tab.key;
      this.picks = [];
    }
  }

  clearPicks() {
    this.canvas.clearPicks();
    this.picks = [];
  }

  // Closes a tab: the block or file leaves the session. The last one closes
  // the window too (only this way: a window with nothing yet stays open).
  closeTab(cx, i) {
    const tab = this.tabs[i];
    if (!tab) return;
    const key = fileKeyOf(tab);
    this.session.files = this.session.files.flatMap((r) => {
      if (refKey(r) !== key) return [r];
      if (!tab.block) return [];
      const blocks = (r.blocks ?? this.tabs.filter((t) => fileKeyOf(t) === key).map((t) => t.block)).filter((b) => b !== tab.block);
      return blocks.length ? [{ ...r, blocks }] : [];
    });
    this.session.pins = this.session.pins.filter((k) => k !== tab.key);
    this.session.order = this.session.order.filter((k) => k !== tab.key);
    delete this.session.views[tab.key];
    this.tabs = this.tabs.filter((_, j) => j !== i);
    this.results.delete(tab.key);
    if (this.tab >= i && this.tab > 0) this.tab--;
    this.shownKey = null;
    this.canvas.set(null);
    this.watch(cx);
    this.saveSoon(cx);
    if (!this.tabs.length) {
      this.flush();
      if (this.overlay) closeOverlay(this.overlay);
      else this.openPicker(cx);
      return;
    }
    this.select(this.tab);
  }

  // Closes every tab: the session keeps no diagram, and the picker opens to choose again.
  closeAll(cx) {
    this.session.files = [];
    this.session.pins = [];
    this.session.order = [];
    this.session.views = {};
    this.tabs = [];
    this.results.clear();
    this.shownKey = null;
    this.clearPicks();
    this.canvas.set(null);
    this.watch(cx);
    this.saveSoon(cx);
    this.openPicker(cx);
  }

  // Forgets the shown diagram's notes and picks.
  clearAsk() {
    const tab = this.tabs[this.tab];
    if (tab) setShared(NOTES, clearNotes(shared(NOTES), this.noteSession(), tab.key));
    this.clearPicks();
  }

  // Drops tab `from` on tab `to`: pinned tabs move among the pinned, the rest among the rest.
  moveTab(fromKey, toKey) {
    const pins = this.session.pins;
    const pinned = (k) => pins.includes(k);
    if (pinned(fromKey) !== pinned(toKey)) return;
    if (pinned(fromKey)) this.session.pins = moveKey(pins, fromKey, toKey);
    else this.session.order = moveKey(this.tabs.map((t) => t.key).filter((k) => !pinned(k)), fromKey, toKey);
    this.reorder();
  }

  togglePin(key) {
    const pins = this.session.pins;
    this.session.pins = pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
    this.reorder();
  }

  reorder() {
    const key = this.tabs[this.tab]?.key;
    this.tabs = orderTabs(this.tabs, this.session.pins, this.session.order);
    this.tab = Math.max(0, this.tabs.findIndex((t) => t.key === key));
  }

  // Lays out diagrams outside render (Herdr gives a render 50 ms), one per
  // host round trip so no task slice runs long; the current tab first. A
  // diagram laid out before, by this window or an earlier one, comes from the cache.
  //
  // Herdr stops a task slice that runs past its budget (half a second) without
  // unwinding it: no catch or finally runs, so the task cannot say it ended.
  // `computing` says what it is at and since when, and a watch on a timer
  // finds a diagram that has been laid out for longer than any slice can
  // run: that one was stopped. It is marked as too big to draw here, and the
  // rest are laid out on.
  compute(cx) {
    // Set before the task: its body runs synchronously up to the first
    // await, and with nothing to do it ends before spawn returns.
    if (this.computing && now() - this.computing.at < STOPPED_MS) return;
    if (this.computing?.tab) this.stopped(this.computing.tab, cx);
    const run = (this.computing = { at: now(), tab: null });
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const order = [this.tab, ...this.tabs.keys()].filter((i, k, a) => a.indexOf(i) === k);
          const tab = order.map((i) => this.tabs[i]).find((t) => t && t.src != null && this.results.get(t.key)?.src !== t.src);
          if (!tab) break;
          let r = cache().get(tab.key, tab.src);
          if (r) r = { ...r, cached: true };
          else {
            const t0 = now();
            Object.assign(run, { at: t0, tab });
            try {
              await prepare(tab.src); // the diagram type's code, the first time it is needed
              const out = mermaidScene(tab.src);
              r = { src: tab.src, v: diagramVersion(tab.src), scene: out.scene, type: out.type, ms: now() - t0, error: null };
              cache().set(tab.key, tab.src, r);
            } catch (e) {
              const old = this.results.get(tab.key);
              // A file mid-edit that does not parse keeps its last drawing, and
              // the version of the text that was drawn from (`v`), which notes go by.
              r = { src: tab.src, v: old?.v ?? null, scene: old?.scene ?? null, type: old?.type, ms: now() - t0, error: String(e?.message ?? e) };
            }
          }
          run.tab = null;
          this.results.set(tab.key, r);
          if (tab === this.tabs[this.tab]) {
            this.show();
            cx.notify();
          }
          await cx.sleep(0); // a host round trip between diagrams
        }
      } finally {
        if (this.computing === run) this.computing = null;
      }
    });
    const watch = (cx) => {
      if (this.computing !== run) return;
      if (now() - run.at >= STOPPED_MS) this.compute(cx);
      else cx.timer.after(STOPPED_MS, watch);
    };
    cx.timer.after(STOPPED_MS, watch);
  }

  // A diagram whose layout Herdr stopped: its last drawing stays, if it had
  // one, as with text that does not parse, and it is tried again when it changes.
  stopped(tab, cx) {
    const old = this.results.get(tab.key);
    this.results.set(tab.key, {
      src: tab.src, v: old?.v ?? null, scene: old?.scene ?? null, type: old?.type, ms: null,
      error: "Too big to lay out here: it took longer than Herdr lets one step run.",
    });
    if (tab === this.tabs[this.tab]) {
      this.show();
      cx.notify();
    }
  }

  // Writes the session after a quiet moment: shared state re-renders every mod.
  saveSoon(cx) {
    if (!this.sessionId || this.saving) return;
    this.saving = true;
    cx.spawn(async (cx) => {
      await cx.sleep(SAVE_MS);
      this.saving = false;
      this.flush();
    });
  }

  flush() {
    if (!this.sessionId) return;
    const live = new Set(terminals().map((t) => t.address));
    const all = pruneSessions(shared(SESSIONS) ?? {}, live, now(), SESSION_GRACE_MS);
    all[this.sessionId] = { ...this.session, at: now() };
    setShared(SESSIONS, all);
  }

  // --- the picker ------------------------------------------------------------

  // Starts at the folder of the shown diagram, else the opener's repository.
  openPicker(cx) {
    const shown = this.tabs[this.tab];
    const machine = shown?.machine ?? this.owner.machine;
    // `chosen`: file key -> "all" | Set of block ids | true (a diagram file).
    const chosen = new Map();
    for (const r of this.session.files) chosen.set(refKey(r), /\.(md|markdown)$/i.test(r.path) ? (r.blocks ? new Set(r.blocks) : "all") : true);
    this.picker = { machine, dir: null, tree: null, error: null, chosen, open: new Set() };
    this.query.set_value("");
    cx.spawn(async (cx) => {
      let dir = shown ? dirOf(shown.file) : null;
      if (!dir && this.owner.cwd) {
        const top = await exec("git", ["-C", this.owner.cwd, "rev-parse", "--show-toplevel"], { on: machine, timeout: 5000 }).catch(() => null);
        dir = top?.code === 0 ? top.stdout.trim() : this.owner.cwd;
      }
      await this.scan(cx, dir ?? "/");
      this.query.focus();
    });
  }

  // Lists what can be drawn under `dir`: diagram files with their type, and
  // Markdown files' mermaid blocks, found with find and grep on its machine.
  async scan(cx, dir) {
    const p = this.picker;
    if (!p) return;
    p.dir = dir.replace(/(.)\/$/, "$1");
    p.tree = null;
    p.error = null;
    await this.knowHome(p.machine);
    this.pathBar.set_value(this.shortPath(p.machine, p.dir));
    cx.notify();
    const opts = { on: p.machine, timeout: 10000 };
    const find = (names, tail) => exec("find", [p.dir, "-maxdepth", SCAN_DEPTH, ...SCAN_SKIP, "-type", "f", "(", ...names, ")", ...tail], opts);
    const docs = ["-name", "*.md", "-o", "-name", "*.markdown"], diagrams = ["-name", "*.mmd", "-o", "-name", "*.mermaid"];
    try {
      const [files, md, types] = await Promise.all([
        find([...diagrams, "-o", ...docs], ["-print0"]),
        find(docs, ["-exec", "grep", "-H", "-n", "--null", "-A1", "-E", HEADINGS_AND_FENCES, "{}", "+"]),
        find(diagrams, ["-exec", "grep", "-H", "-n", "--null", "-m1", "-E", DIAGRAM_TYPES, "{}", "+"]),
      ]);
      if (this.picker !== p) return;
      if (files.code !== 0 && !files.stdout) throw new Error((files.stderr || `cannot list ${p.dir}`).trim());
      p.tree = pickerTree(p.dir, files.stdout.split("\0").filter(Boolean), mdBlocksFromGrep(md.stdout), typesFromGrep(types.stdout));
    } catch (e) {
      p.tree = { groups: [], items: [] };
      p.error = String(e?.message ?? e);
    }
    cx.notify();
  }

  goTo(cx, text) {
    const p = this.picker;
    if (!p) return;
    cx.spawn(async (cx) => {
      // "~" needs the home folder of the machine the path names.
      const named = String(text).trim().match(/^([\w.-]+):~/)?.[1];
      await this.knowHome(named ?? p.machine);
      const ref = parseRef(text, p.machine, this.homes);
      if (!ref) {
        notify({ title: "Mermaid view", body: "Give an absolute path or one from ~, on another machine as machine:/path.", level: "info", timeout: 5000 });
        return;
      }
      p.machine = ref.machine;
      // A diagram file's path opens its folder with it checked.
      let dir = ref.path;
      if (/\.(mmd|mermaid|md|markdown)$/i.test(ref.path)) {
        dir = dirOf(ref.path);
        p.chosen.set(refKey(ref), /\.(md|markdown)$/i.test(ref.path) ? "all" : true);
      }
      await this.scan(cx, dir);
    });
  }

  // Each row's check state: "all", "some" or "none".
  itemState(item) {
    const c = this.picker.chosen.get(refKey({ machine: this.picker.machine, path: item.path }));
    if (!item.md) return c ? "all" : "none";
    if (c === "all") return "all";
    if (!c?.size) return "none";
    return item.blocks.every((b) => c.has(b.id)) ? "all" : "some";
  }

  toggleItem(item) {
    const key = refKey({ machine: this.picker.machine, path: item.path });
    if (this.itemState(item) === "all") this.picker.chosen.delete(key);
    else this.picker.chosen.set(key, item.md ? "all" : true);
  }

  toggleBlock(item, block) {
    const p = this.picker, key = refKey({ machine: p.machine, path: item.path });
    const c = p.chosen.get(key);
    const set = c === "all" ? new Set(item.blocks.map((b) => b.id)) : new Set(c instanceof Set ? c : []);
    if (set.has(block.id)) set.delete(block.id);
    else set.add(block.id);
    if (set.size) p.chosen.set(key, set);
    else p.chosen.delete(key);
  }

  toggleGroup(items) {
    const full = items.every((i) => this.itemState(i) === "all");
    for (const i of items) if ((this.itemState(i) === "all") === full) this.toggleItem(i);
  }

  // The checks become the session's files: those under the picker's path as
  // checked, the rest as they were.
  applyPicker(cx) {
    const p = this.picker;
    if (!p?.tree) return;
    const under = (r) => r.machine === p.machine && r.path.startsWith(`${p.dir}/`);
    const listed = new Set([...p.tree.items, ...p.tree.groups.flatMap((g) => g.items)].map((i) => i.path));
    const keep = this.session.files.filter((r) => !under(r) || !listed.has(r.path));
    const picked = [];
    for (const [key, c] of p.chosen) {
      const ref = parseRef(key, null);
      if (!ref || !under(ref) || !listed.has(ref.path)) continue;
      picked.push({ ...ref, blocks: c instanceof Set ? [...c] : null });
    }
    const files = [...keep, ...picked];
    if (!files.length) return; // nothing to show: stay in the picker
    // Files kept keep their place; new ones follow.
    const was = this.session.files.map(refKey);
    files.sort((a, b) => (was.indexOf(refKey(a)) + 1 || Infinity) - (was.indexOf(refKey(b)) + 1 || Infinity));
    this.session.files = files;
    this.picker = null;
    this.saveSoon(cx);
    this.watch(cx);
    cx.spawn(async (cx) => this.load(cx, { force: true }));
    cx.notify();
  }

  closePicker(cx) {
    this.picker = null;
    cx.notify();
  }

  renderPicker(t) {
    const p = this.picker, q = this.query.value().trim();
    const box = (state) => div().w(16).flex_none().text_color(state === "none" ? t.dim : t.accent).child(state === "all" ? "☑" : state === "some" ? "▣" : "☐");
    const rows = [];
    const add = (row) => rows.length < ROWS_MAX && rows.push(row);
    const itemRows = (item, indent, gid) => {
      const blocks = item.md ? item.blocks.filter((b) => !q || matches(`${item.rel} ${b.heading ?? ""} ${b.type ?? ""}`, q)) : [];
      if (q && !matches(item.rel, q) && !blocks.length) return;
      const multi = item.md && item.blocks.length > 1;
      const fkey = `${gid}|${item.path}`;
      const open = multi && (p.open.has(fkey) || !!q);
      const n = rows.length;
      add(h_flex().pl(8 + indent).pr(8).py(3).gap(6).rounded(UI.radius).items_center().hover((s) => s.bg(t.hover))
        // The arrow opens and shuts a file's blocks; the rest of the row checks.
        .child(div().id(`mv-i-arrow-${n}`).w(12).flex_none().text_color(t.dim)
          .when(multi, (e) => e.cursor_pointer().on_click((_e, cx) => { open ? p.open.delete(fkey) : p.open.add(fkey); cx.notify(); }))
          .child(multi ? (open ? "▾" : "▸") : ""))
        .child(h_flex().id(`mv-i-${n}`).flex_1().min_w(0).gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.toggleItem(item); cx.notify(); })
          .child(box(this.itemState(item)))
          .child(div().flex_1().truncate().child(item.rel))
          .child(div().text_size(UI.small).text_color(t.dim).child(item.md ? (multi ? `${item.blocks.length} blocks` : `${item.blocks[0].heading ?? "block"} · ${item.blocks[0].type ?? "?"}`) : item.type ?? ""))));
      if (!open) return;
      const c = p.chosen.get(refKey({ machine: p.machine, path: item.path }));
      for (const b of q ? blocks : item.blocks) {
        const on = c === "all" || (c instanceof Set && c.has(b.id));
        add(h_flex().id(`mv-b-${rows.length}`).pl(8 + indent + 34).pr(8).py(3).gap(6).rounded(UI.radius).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .child(box(on ? "all" : "none"))
          .child(div().flex_1().truncate().child(b.heading ?? `block ${b.index + 1}`))
          .child(div().text_size(UI.small).text_color(t.dim).child(`${b.type ?? "?"} · L${b.line}`))
          .on_click((_e, cx) => { this.toggleBlock(item, b); cx.notify(); }));
      }
    };
    if (p.tree) {
      if (p.dir !== "/") {
        add(h_flex().id("mv-up").px(8).py(3).gap(6).rounded(UI.radius).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).text_color(t.muted)
          .on_click((_e, cx) => { cx.spawn(async (cx) => this.scan(cx, dirOf(p.dir))); })
          .child(div().w(12).child("↰")).child(".."));
      }
      for (const g of p.tree.groups) {
        const visible = q ? g.items.filter((i) => matches(i.rel, q) || (i.md && i.blocks.some((b) => matches(`${i.rel} ${b.heading ?? ""} ${b.type ?? ""}`, q)))) : g.items;
        if (q && !visible.length) continue;
        const open = p.open.has(g.name) || !!q;
        const count = g.items.reduce((n, i) => n + (i.md ? i.blocks.length : 1), 0);
        const states = g.items.map((i) => this.itemState(i));
        const state = states.every((s) => s === "all") ? "all" : states.every((s) => s === "none") ? "none" : "some";
        add(h_flex().id(`mv-g-${rows.length}`).px(8).py(3).gap(6).rounded(UI.radius).items_center().hover((s) => s.bg(t.hover))
          .child(div().id(`mv-g-arrow-${g.name}`).w(12).flex_none().cursor_pointer().text_color(t.dim)
            .on_click((_e, cx) => { open ? p.open.delete(g.name) : p.open.add(g.name); cx.notify(); })
            .child(open ? "▾" : "▸"))
          .child(div().id(`mv-g-box-${g.name}`).cursor_pointer().on_click((_e, cx) => { this.toggleGroup(g.items); cx.notify(); }).child(box(state)))
          .child(div().id(`mv-g-name-${g.name}`).flex_1().truncate().cursor_pointer().font_semibold()
            // One click opens and shuts it; two go into the folder.
            .on_click((e, cx) => {
              if (e.click_count >= 2) cx.spawn(async (cx) => this.scan(cx, g.path));
              else open ? p.open.delete(g.name) : p.open.add(g.name);
              cx.notify();
            })
            .child(`${g.name}/`))
          .child(div().text_size(UI.small).text_color(t.dim).child(`${count} diagram${count === 1 ? "" : "s"}`)));
        if (open) for (const i of visible) itemRows(i, 20, g.name);
      }
      for (const i of p.tree.items) itemRows(i, 0, "");
    }
    const empty = p.tree && !p.tree.groups.length && !p.tree.items.length;
    return v_flex().size_full().bg(t.surface).text_size(UI.text).text_color(t.foreground)
      .track_focus(this.focus)
      .on_key_down((e, cx) => {
        if (e.keystroke !== "cmd-enter") return;
        cx.stop_propagation();
        this.applyPicker(cx);
        cx.notify();
      })
      .child(bar(t, "top")
        .child(div().flex_1().text_size(UI.title).font_semibold().child(`Diagrams for ${this.owner.name}`))
        .when(!!this.overlay, (e) => e.child(button(t, "mv-pick-x", "✕", () => { this.flush(); closeOverlay(this.overlay); }, { tight: true, tip: "Close (Option+M)" }))))
      .child(v_flex().flex_1().min_h(0).p(UI.pad).gap(UI.gap)
        .child(field(t, this.pathBar))
        .child(field(t, this.query, true))
        // A click in the list leaves the fields: the picker keeps the keyboard, for Cmd+Enter.
        .child(v_flex().id("mv-pick-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
          .on_mouse_down("left", () => this.focus.focus())
          .when(!p.tree, (e) => e.child(div().p(8).text_color(t.dim).child(p.dir ? `Looking in ${p.dir}…` : "…")))
          .when(!!p.error, (e) => e.child(div().p(8).text_color(t.blocked).child(p.error)))
          .when(!!empty && !p.error, (e) => e.child(div().p(8).text_color(t.dim).child("Nothing to draw under this path: no .mmd or .mermaid file, no Markdown mermaid block.")))
          .children(rows)))
      .child(bar(t, "bottom")
        .child(div().flex_1().min_w(0).truncate().text_size(UI.small).text_color(t.dim).child("Check what to show · ▸ opens a folder or a file's blocks · double-click a folder to go in · ⌘↩ shows"))
        // Back sits where Files is on the diagram, so it goes back the way it came;
        // with nothing shown yet there is nowhere to go back to (✕ closes).
        .when(this.session.files.length > 0, (e) => e.child(button(t, "mv-pick-back", "Back", (cx) => this.closePicker(cx), { width: UI.slot })))
        .child(button(t, "mv-pick-apply", "Show", (cx) => this.applyPicker(cx), { enabled: !!p.tree, strong: true, width: UI.mainSlot, tip: "Show (Cmd+Enter)" })));
  }

  // --- notes and asking -----------------------------------------------------

  // Whose notes these are: the session, or for a pane its files.
  noteSession() {
    return this.sessionId ?? `pane:${this.session.files.map(refKey).join("|")}`;
  }

  // The shown tab's notes as kept: { items: key -> text, groups: [{ ids: keys, text }] } (see noteKey).
  tabNotes() {
    const tab = this.tabs[this.tab];
    return tab ? notesFor(shared(NOTES), this.noteSession(), tab.key) : { items: {}, groups: [] };
  }

  // The shown diagram's parts, by scene item index: each item with what it says (its label)
  // and where the author wrote it. Labels are worked out once a scene.
  parts() {
    const scene = this.canvas.scene;
    if (!scene) return [];
    if (this.partsOf?.scene !== scene) {
      const labels = sceneLabels(scene);
      this.partsOf = { scene, parts: scene.items.map((it, i) => ({ ...it, label: labels[i] })) };
    }
    return this.partsOf.parts;
  }

  // The index of the part a scene item is (see partIndex).
  partAt(item) {
    const i = this.canvas.scene?.items.indexOf(item) ?? -1;
    return i < 0 ? -1 : partIndex(this.parts(), i);
  }

  // A part as the dialogs and the request take it.
  partProps(i) {
    const { id, kind, role, label, line, end, symbol, from, to } = this.parts()[i];
    return { id, kind, role, label, line, end, symbol, from, to };
  }

  // The version of the text the shown drawing comes from (see diagramVersion).
  version() {
    const tab = this.tabs[this.tab];
    const r = tab && this.results.get(tab.key);
    return r?.scene && r.scene === this.canvas.scene ? r.v : null;
  }

  // The shown tab's notes on the drawing (see resolveNotes): index -> text, the
  // groups, numbered in the order made: { n, text, items (indices), stale },
  // and the notes kept as noted (stale).
  placedNotes() {
    return resolveNotes(this.tabNotes(), this.parts(), this.version());
  }

  // What Ask sends besides groups: the noted parts, then the picks in no group and without a note.
  askParts(placed = this.placedNotes()) {
    const { items, groups } = placed;
    const grouped = new Set(groups.flatMap((g) => g.items));
    const picked = [...new Set(this.picks.map((it) => this.partAt(it)).filter((i) => i >= 0))];
    return [...byLine(this.parts(), items.keys()), ...picked.filter((i) => !items.has(i) && !grouped.has(i))];
  }

  // Notes scene `items`: one part on its own, several as a group. The note
  // there now is replaced, also when its parts have moved since.
  openNote(items) {
    const tab = this.tabs[this.tab];
    const at = [...new Set((items ?? []).map((it) => this.partAt(it)).filter((i) => i >= 0))];
    if (!tab || !at.length) return;
    const parts = this.parts(), notes = this.tabNotes(), v = this.version();
    let text = "", was = null;
    if (at.length === 1) {
      was = Object.keys(notes.items).find((k) => locate(parts, k, v) === at[0]) ?? null;
      if (was) text = notes.items[was];
    } else {
      const want = [...at].sort((a, b) => a - b).join();
      const g = this.placedNotes().groups.find((g) => [...g.items].sort((a, b) => a - b).join() === want);
      if (g) {
        const kept = notes.groups[g.n - 1];
        text = kept.text;
        was = kept.ids;
      }
    }
    openOverlay({
      mod: MOD,
      kind: "dialog",
      width: 480,
      props: {
        note: {
          session: this.noteSession(),
          tabKey: tab.key,
          tab: { name: tab.name, file: tab.file, src: tab.src, line0: tab.line0 ?? 0 },
          parts: at.map((i) => this.partProps(i)),
          keys: at.map((i) => noteKey(parts[i], v)),
          was,
          text,
        },
      },
    });
  }

  initNote(p, cx) {
    this.note = p.note;
    this.overlay = p.overlay;
    this.input = InputState.new({ placeholder: p.note.parts.length === 1 ? "A note on this part" : "A note on these parts together" });
    this.input.set_value(p.note.text);
    // Cmd+Enter keeps the note and asks at once, through the diagram's window.
    this.input.on("submit", (e, cx) => {
      this.saveNote(this.input.value());
      if (e.secondary) run(`${MOD}.ask-now`);
    });
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.input.focus();
      cx.notify();
    });
  }

  saveNote(text) {
    const n = this.note;
    setShared(NOTES, n.keys.length === 1
      ? setNote(shared(NOTES), n.session, n.tabKey, n.keys[0], text, n.was ?? n.keys[0])
      : setGroupNote(shared(NOTES), n.session, n.tabKey, n.keys, text, n.was ?? n.keys));
    closeOverlay(this.overlay);
  }

  renderNote() {
    const t = theme(), { parts, tab } = this.note;
    const one = parts.length === 1;
    return v_flex().w_full().p(UI.pad).gap(UI.gap).text_size(UI.text).text_color(t.foreground)
      .child(div().text_size(UI.title).font_semibold().child(one ? `Note on ${parts[0].label || parts[0].symbol || parts[0].id}` : `Note on ${parts.length} parts together`))
      .when(one, (e) => e.child(div().text_color(t.muted).truncate().child(`${partText(tab, parts[0])} · ${tab.name}`)))
      .when(!one, (e) => e.child(v_flex().gap(2).text_color(t.muted)
        .children(parts.slice(0, 6).map((q) => div().truncate().child(partText(tab, q))))
        .when(parts.length > 6, (e) => e.child(div().text_color(t.dim).child(`and ${parts.length - 6} more`)))))
      .child(field(t, this.input, true))
      .child(h_flex().gap(UI.gap).items_center()
        .child(div().flex_1().text_size(UI.small).text_color(t.dim).child("Enter keeps it on the diagram until you Ask · ⌘↩ sends it now · Esc cancels"))
        .when(!!this.note.text, (e) => e.child(button(t, "mv-note-remove", "Remove", () => this.saveNote("")))));
  }

  // The session's agent; for a pane, the latest agent in the focused tab.
  target() {
    const list = agents();
    const own = this.owner.id ? list.find((a) => a.address === this.owner.id) : null;
    if (own) return own;
    const here = focused()?.tab;
    const mine = list.filter((a) => a.tab === here);
    return (mine.length ? mine : list).slice().sort((a, b) => b.seq - a.seq)[0] ?? null;
  }

  // What asking now would send: the groups, the noted and the picked parts,
  // each with its note; null when there is no diagram or no agent.
  askRequest() {
    const tab = this.tabs[this.tab];
    if (!tab || tab.src == null) return null;
    const agent = this.target();
    if (!agent) {
      notify({ title: "Mermaid view", body: "No agent to ask.", level: "info", timeout: 6000 });
      return null;
    }
    // The request carries the text as it is now. When the drawing is not of it
    // (the text is being drawn again, or does not draw), what was picked on
    // the drawing, and every note, goes as noted before the diagram changed.
    const r = this.results.get(tab.key);
    const fresh = !!r?.scene && r.scene === this.canvas.scene && !r.error && r.src === tab.src;
    const placed = fresh ? this.placedNotes() : resolveNotes(this.tabNotes(), [], null);
    const part = (i) => ({ ...this.partProps(i), stale: !fresh });
    return {
      session: this.noteSession(),
      tabKey: tab.key,
      tab: { name: tab.name, file: tab.file, src: tab.src, line0: tab.line0 ?? 0 },
      groups: placed.groups.map((g) => ({ n: g.n, text: g.text, parts: [...g.items.map(part), ...g.stale] })),
      picks: [...this.askParts(placed).map((i) => ({ ...part(i), note: placed.items.get(i) ?? "" })), ...placed.stale],
      agent: { address: agent.address, name: agent.app ?? agent.title },
    };
  }

  // The Ask dialog, for a comment on the whole diagram.
  openAsk() {
    const ask = this.askRequest();
    if (ask) openOverlay({ mod: MOD, kind: "dialog", width: 560, props: { ask } });
  }

  // Cmd+Enter: notes say what to ask, so they go at once; without any, the
  // dialog asks for a comment on the whole diagram, and with one made before
  // the diagram changed, it shows what goes.
  askNow(cx) {
    const ask = this.askRequest();
    if (!ask) return;
    if (!staleIn(ask) && deliver(ask, "", cx)) this.clearPicks();
    else openOverlay({ mod: MOD, kind: "dialog", width: 560, props: { ask } });
  }

  initAsk(p, cx) {
    this.ask = p.ask;
    this.overlay = p.overlay;
    this.input = InputState.new({ placeholder: p.ask.groups.length || p.ask.picks.some((q) => q.note) ? "A comment on the whole diagram (optional)" : "A comment on the whole diagram" });
    this.input.on("submit", (_e, cx) => this.send(cx));
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.input.focus();
      cx.notify();
    });
  }

  send(cx) {
    if (deliver(this.ask, this.input.value().trim(), cx)) closeOverlay(this.overlay);
  }

  // Forgets the notes made before the diagram changed, and leaves out the parts picked then.
  dropStale() {
    const a = this.ask;
    const keys = [...a.picks, ...a.groups.flatMap((g) => g.parts)].filter((p) => p.stale && p.key).map((p) => p.key);
    setShared(NOTES, dropNotes(shared(NOTES), a.session, a.tabKey, keys));
    // A group left with no part goes, and the ones after it count down, as they do on the diagram.
    const groups = a.groups.map((g) => ({ ...g, parts: g.parts.filter((p) => !p.stale) })).filter((g) => g.parts.length);
    this.ask = { ...a, picks: a.picks.filter((p) => !p.stale), groups: groups.map((g, k) => ({ ...g, n: k + 1 })) };
  }

  renderAsk() {
    const t = theme();
    const { tab, picks, groups, agent } = this.ask;
    const section = (label) => div().text_size(UI.small).text_color(t.dim).child(label);
    return v_flex().w_full().p(UI.pad).gap(UI.gap).text_size(UI.text).text_color(t.foreground)
      .child(div().text_size(UI.title).font_semibold().child(`Ask ${agent.name} about ${tab.name}`))
      .when(groups.length > 0, (e) => e
        .child(section(groups.length === 1 ? "The group" : `The groups (${groups.length})`))
        .child(v_flex().gap(4).text_color(t.muted)
          .children(groups.map((g) => v_flex()
            .child(div().text_color(t.foreground).truncate().child(`G${g.n}: ${g.text}`))
            .children(g.parts.slice(0, 4).map((p) => div().pl(12).truncate().child(partText(tab, p))))
            .when(g.parts.length > 4, (e) => e.child(div().pl(12).text_color(t.dim).child(`and ${g.parts.length - 4} more`)))))))
      .when(picks.length > 0, (e) => e
        .child(section(picks.length === 1 ? "The part" : `The parts (${picks.length})`))
        .child(v_flex().gap(4).text_color(t.muted)
          .children(picks.map((p) => v_flex()
            .child(div().truncate().child(partText(tab, p)))
            .when(!!p.note, (e) => e.child(div().pl(12).text_color(t.foreground).truncate().child(`↳ ${p.note}`)))))))
      .child(section("On the whole diagram"))
      .child(field(t, this.input, true))
      .child(h_flex().gap(UI.gap).items_center()
        .child(div().flex_1().text_size(UI.small).text_color(t.dim).child(staleIn(this.ask)
          ? "Notes made before the diagram changed go as noted · Enter sends · Esc cancels"
          : "The diagram goes with it · Enter sends · Esc cancels"))
        .when(staleIn(this.ask), (e) => e.child(button(t, "mv-ask-drop", "Drop those", () => this.dropStale()))));
  }


  // Pans, then zooms, and records what each render and redraw cost, for
  // tuning the canvas: `herdr-app do mermaid.measure`.
  async measure(cx) {
    const c = this.canvas, out = { pan: [], zoom: [] };
    const v0 = c.currentView();
    if (!v0) return;
    for (let i = 0; i < 8; i++) {
      c.view = { ...c.currentView(), x: c.currentView().x - 20 };
      cx.notify();
      await cx.sleep(40);
      out.pan.push(c.stats.render);
    }
    for (const z of [0.5, 1, 1.5]) {
      const v = c.currentView();
      c.view = { z, x: v.x, y: v.y };
      cx.notify();
      await cx.sleep(400);
      out.zoom.push({ z: c.view.z, render: c.stats.render, paths: c.stats.paths, texts: c.stats.texts, inView: c.inView.size });
    }
    c.view = null;
    cx.notify();
    out.chunks = c.chunks.length;
    out.tab = this.tabs[this.tab]?.name;
    await fs.writeFile(`${appHome()}/data/${MOD}-measure-${out.tab}.json`, JSON.stringify(out, null, 1));
  }

  // --- drawing -------------------------------------------------------------

  render(cx) {
    if (this.ask) return this.renderAsk();
    if (this.note) return this.renderNote();
    const t = theme();
    if (this.picker) return this.renderPicker(t);
    // The view each tab was left at goes into the session.
    const tab = this.tabs[this.tab];
    if (tab && this.canvas.scene && this.results.get(tab.key)?.scene === this.canvas.scene) {
      const v = this.canvas.view;
      if (!sameView(v, this.session.views[tab.key])) {
        if (v) this.session.views[tab.key] = { z: v.z, x: v.x, y: v.y };
        else delete this.session.views[tab.key];
        this.saveSoon(cx);
      }
    }
    return v_flex().id(`${MOD}-root`).size_full().bg(t.surface).text_size(UI.text)
      .track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.canvas.selecting) {
          this.canvas.selecting = false;
          cx.stop_propagation();
          cx.notify();
        } else if (e.keystroke === "cmd-enter") {
          cx.stop_propagation();
          this.askNow(cx);
          cx.notify();
        }
      })
      .child(this.header(t))
      .child(div().flex_1().min_h(0).child(this.body(t, cx)))
      .child(this.footer(t));
  }

  header(t) {
    const z = this.results.get(this.tabs[this.tab]?.key)?.scene ? this.canvas.zoomLevel() : null;
    const pins = this.session.pins;
    const selecting = this.canvas.selecting;
    return bar(t, "top").gap(4)
      .on_mouse_up("left", () => (this.pressedTab = null)) // a tab let go of off the tabs
      .child(h_flex().id("mv-tabs").flex_1().min_w(0).gap(4).overflow_x_scrollbar()
        .children(this.tabs.map((tab, i) => {
          const pinned = pins.includes(tab.key), shown = i === this.tab, hovered = this.hoverTab === tab.key;
          // A small control in a tab: its own press, or the tab's would start a move.
          const control = (id, child, on) => div().id(id).px(3).py(2).rounded(4).flex_none()
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.pressedTab = null; on(cx); cx.notify(); })
            .child(child);
          return h_flex().id(`mv-tab-${i}`).pl(4).pr(4).py(2).gap(4).rounded(UI.radius).items_center().cursor_pointer().whitespace_nowrap().flex_none()
            .bg(shown ? t.selected : t.surface).hover((s) => s.bg(t.hover))
            .when(this.pressedTab && this.pressedTab !== tab.key, (e) => e.border_l_2().border_color(t.accent))
            .text_color(shown ? t.foreground : tab.src == null ? t.dim : t.muted)
            .on_mouse_down("left", (_e, cx) => {
              cx.stop_propagation(); // a tab drag moves the tab, not the window
              this.pressedTab = tab.key;
            })
            // There is no group hover: the tab under the pointer is remembered to show its pin.
            .on_hover((on, cx) => {
              if (on) this.hoverTab = tab.key;
              else if (this.hoverTab === tab.key) this.hoverTab = null;
              cx.notify();
            })
            .on_mouse_up("left", (_e, cx) => {
              const from = this.pressedTab;
              this.pressedTab = null;
              if (from && from !== tab.key) {
                this.moveTab(from, tab.key);
                this.saveSoon(cx);
              } else this.select(i);
              cx.notify();
            })
            // A pinned tab shows its pin; the shown tab and the one under the pointer offer one.
            .when(pinned || shown || hovered, (e) => e.child(control(`mv-tab-pin-${i}`, icon("pin").size(12).text_color(pinned ? t.accent : t.dim), (cx) => {
              this.togglePin(tab.key);
              this.saveSoon(cx);
            })))
            .when(!pinned && !shown && !hovered, (e) => e.child(div().w(18)))
            .child(div().child(tab.name))
            .child(control(`mv-tab-x-${i}`, div().text_size(UI.small).text_color(t.dim).child("✕"), (cx) => this.closeTab(cx, i)));
        })))
      .child(button(t, "mv-close-all", "Clear all", (cx) => this.closeAll(cx), { enabled: this.tabs.length > 0, tip: "Close every tab" }))
      .child(div().w(UI.gap))
      .child(button(t, "mv-move", icon("move").text_color(selecting ? t.muted : t.foreground), () => (this.canvas.selecting = false), { active: !selecting, tight: true, tip: "Move: drag pans" }))
      .child(button(t, "mv-select", icon("select").text_color(selecting ? t.foreground : t.muted), () => (this.canvas.selecting = true), { active: selecting, tight: true, tip: "Select: drag a box to pick (Esc: Move)" }))
      .child(div().w(1).h(16).mx(2).bg(t.border))
      .child(button(t, "mv-note", h_flex().gap(4).items_center().child(icon("note")).child("Note"), () => this.openNote(this.picks),
        { enabled: this.picks.length > 0, tight: true, tip: this.picks.length > 1 ? "Note on the picked parts together (or double-click one)" : "Note on the picked part (or double-click it)" }))
      .child(div().w(UI.gap))
      .child(button(t, "mv-zoom-out", "−", () => this.canvas.zoomBy(0.8), { enabled: z !== null, tight: true }))
      .child(button(t, "mv-zoom", z === null ? "–" : `${Math.round(z * 100)}%`, () => this.canvas.zoomTo(1), { enabled: z !== null, tight: true, tip: "100%" }))
      .child(button(t, "mv-zoom-in", "+", () => this.canvas.zoomBy(1.25), { enabled: z !== null, tight: true }))
      .child(button(t, "mv-fit", "Fit", () => this.canvas.fit(), { tight: true }))
      .when(!!this.overlay, (e) => e.child(button(t, "mv-close", "✕", () => { this.flush(); closeOverlay(this.overlay); }, { tight: true, tip: "Close (Option+M)" })));
  }

  body(t, cx) {
    const tab = this.tabs[this.tab];
    const r = tab && this.results.get(tab.key);
    if (!r?.scene) {
      const why = !tab ? "Nothing shown: Files picks diagrams." : tab.src == null ? `Cannot read ${tab.machine ? `${tab.machine}:` : ""}${tab.file}` : r?.error ?? "Drawing…";
      return div().size_full().flex().items_center().justify_center().text_color(r?.error || tab?.src == null ? t.blocked : t.muted).child(why);
    }
    // One label a part: its groups' tags, G1 and on (the first part of a
    // group also shows the group's note), then its own note.
    const placed = this.placedNotes(), labels = new Map();
    const add = (i, text) => labels.set(i, [...(labels.get(i) ?? []), text]);
    for (const g of placed.groups) g.items.forEach((i, k) => add(i, k ? `G${g.n}` : `G${g.n}: ${g.text}`));
    for (const [i, text] of placed.items) add(i, text);
    const badges = [...labels].map(([item, texts]) => ({ item, text: texts.join(" · ") }));
    return this.canvas.element(t, cx, { badges, css: this.peleVars(tab) });
  }

  footer(t) {
    const tab = this.tabs[this.tab];
    const r = tab && this.results.get(tab.key);
    const placed = this.placedNotes();
    const noted = placed.items.size + placed.stale.length + placed.groups.length;
    // Parts noted before the diagram changed, off the drawing.
    const old = placed.stale.length + placed.groups.reduce((n, g) => n + g.stale.length, 0);
    const asking = this.askParts(placed).length + placed.stale.length + placed.groups.length;
    const parts = [];
    if (tab?.file) parts.push([`${this.shortPath(tab.machine, tab.file)}${tab.line0 ? `:${tab.line0 + 1}` : ""}`, t.muted]);
    if (this.canvas.selecting) parts.push(["Select: drag a box · Cmd adds · Option removes · Esc: Move", t.accent]);
    else if (this.picks.length === 1 && this.partAt(this.picks[0]) >= 0) {
      parts.push([`picked ${partText(tab, this.partProps(this.partAt(this.picks[0])))}`, t.dim]);
    } else if (this.picks.length > 1) parts.push([`${this.picks.length} picked`, t.dim]);
    if (noted) parts.push([`${noted} note${noted === 1 ? "" : "s"}${old ? ` (${old} from before a change)` : ""}`, t.dim]);
    if (r?.error) parts.push([r.error, t.blocked]);
    else if (r?.scene) parts.push([`${r.type} · ${r.cached ? "cached" : `${r.ms} ms`} · ${this.canvas.inView.size}/${this.canvas.chunks.length} pieces`, t.dim]);
    return bar(t, "bottom")
      .child(h_flex().flex_1().min_w(0).gap(14).overflow_hidden().text_size(UI.small)
        .children(parts.map(([p, c], i) => div().whitespace_nowrap().text_color(c).when(i === 0, (e) => e.min_w(0).truncate()).child(p))))
      .child(button(t, "mv-ask-clear", "Clear", () => this.clearAsk(), { enabled: asking > 0 }))
      // Files and Ask in the picker's Back and Show places.
      .child(button(t, "mv-files", "Files", (cx) => this.openPicker(cx), { width: UI.slot }))
      .child(button(t, "mv-ask", asking ? `Ask (${asking})` : "Ask", () => this.openAsk(), { enabled: !!tab && tab.src != null, strong: true, width: UI.mainSlot, tip: "Ask (Cmd+Enter)" }));
  }
}
