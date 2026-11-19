// Each item of a scene knows where the author wrote it: its line in the
// diagram's text (and last line, for a block), the name it was given, and for
// a connection the names of its two ends. Lines count the text as written,
// front matter and comments included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, renderScene } from "../build/pele.js";
import { mermaidScene } from "../src/index.js";

const source = (it) => {
  const out = {};
  for (const k of ["line", "end", "symbol", "from", "to"]) if (it[k] !== undefined) out[k] = it[k];
  return out;
};
const find = (scene, pred) => scene.items.filter(pred).map(source);

const FLOW = `---
title: Release
---
flowchart TD
  %% a comment line
  a --> b --> c
  c -->|go| push
  push["Push it"]
  subgraph grp [Group]
    d
  end
  subgraph Two words
    e
  end
`;

test("flowchart items know their line, name and ends", () => {
  const { scene } = mermaidScene(FLOW);
  const node = (id) => find(scene, (it) => it.id === id && it.kind.startsWith("pele-node"));
  assert.deepEqual(node("a"), [{ line: 6, symbol: "a" }]);
  assert.deepEqual(node("c"), [{ line: 6, symbol: "c" }]);
  // Where the node is defined, not where it is first mentioned.
  assert.deepEqual(node("push"), [{ line: 8, symbol: "push" }]);
  assert.deepEqual(node("d"), [{ line: 10, symbol: "d" }]);
  const edges = find(scene, (it) => it.kind.startsWith("pele-edge") && !it.kind.includes("label"));
  assert.deepEqual(edges, [
    { line: 6, from: "a", to: "b" },
    { line: 6, from: "b", to: "c" },
    { line: 7, from: "c", to: "push" },
  ]);
  const groups = find(scene, (it) => it.kind.startsWith("pele-cluster"));
  // A subgraph named by its title alone has no name of its own to point at.
  assert.deepEqual(groups.sort((x, y) => x.line - y.line), [{ line: 9, end: 11, symbol: "grp" }, { line: 12, end: 14 }]);
});

test("a flowchart node comes from where the label it shows is written; a connection spans its ends", () => {
  const src = 'flowchart TD\n  A[first] --> B\n  A[second]\n  x["one\n  two"] -- "three\n  four" --> y\n  p --> q --> r\n';
  const { scene } = mermaidScene(src);
  const node = (id) => find(scene, (it) => it.id === id && it.kind.startsWith("pele-node"));
  // Drawn as "second", the last label given.
  assert.deepEqual(node("A"), [{ line: 3, symbol: "A" }]);
  assert.deepEqual(node("x"), [{ line: 4, end: 5, symbol: "x" }]);
  const edges = find(scene, (it) => it.kind.startsWith("pele-edge") && !it.kind.includes("label"));
  assert.deepEqual(edges, [
    { line: 2, from: "A", to: "B" },
    { line: 4, end: 6, from: "x", to: "y" },
    { line: 7, from: "p", to: "q" },
    { line: 7, from: "q", to: "r" },
  ]);
});

test("pele records where items are written only when asked", () => {
  const model = parse(FLOW), recorded = parse(FLOW, { sourceInfo: true });
  assert.ok([...model.nodes.values()].every((n) => n.source === undefined));
  assert.deepEqual(recorded.nodes.get("push").source, { line: 8, symbol: "push" });
  // A scene always asks for them.
  assert.deepEqual(source(renderScene(FLOW).scene.items.find((it) => it.id === "push")), { line: 8, symbol: "push" });
});

const SEQ = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: retry 3 times
  B-->>A: ok
  loop every 0 s
    A->>B: ping
  end
  Note over A,B: 1 note
  A->>C: new
`;

test("sequence items know their line, name and ends", () => {
  const { scene } = mermaidScene(SEQ);
  const messages = find(scene, (it) => it.kind.includes("pele-message"));
  assert.deepEqual(messages, [
    { line: 4, from: "A", to: "B" },
    { line: 5, from: "B", to: "A" },
    { line: 7, from: "A", to: "B" },
    { line: 10, from: "A", to: "C" },
  ]);
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-note")), [{ line: 9 }]);
  const actor = (id) => find(scene, (it) => it.id === id && it.kind.includes("pele-actor") && !it.kind.includes("footer"));
  assert.deepEqual(actor("A"), [{ line: 2, symbol: "A" }]);
  // A participant first seen in a message comes from that message.
  assert.deepEqual(actor("C"), [{ line: 10, symbol: "C" }]);
  // The lifeline and the box at the bottom are the participant too.
  assert.deepEqual(find(scene, (it) => it.id === "B" && it.kind === "pele-lifeline"), [{ line: 3, symbol: "B" }]);
});

test("asked for sources, a sequence diagram's blocks are parts that span their lines", () => {
  const src = "sequenceDiagram\n  loop every min\n    A->>B: ping\n  end\n  alt ok\n    B->>A: y\n  else no\n    B->>A: n\n  end\n  rect rgb(200,200,255)\n    A->>B: x\n  end\n";
  const blocks = (scene) => find(scene, (it) => /pele-frame|pele-rect/.test(it.kind));
  assert.deepEqual(blocks(mermaidScene(src).scene), [{ line: 10, end: 12 }, { line: 2, end: 4 }, { line: 5, end: 9 }]);
});

test("a sequence box spans its lines, from box to its end", () => {
  const { scene } = mermaidScene("sequenceDiagram\n  box Aqua Front\n    participant A\n  end\n  A->>A: hi\n");
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-box")), [{ line: 2, end: 4 }]);
});

test("a swimlane lane spans its subgraph; the lane for nodes outside every subgraph is written nowhere", () => {
  const { scene } = mermaidScene("swimlane-beta\n  subgraph Finance\n    a[Pay]\n  end\n  subgraph ops [Operations]\n    b[Ship]\n  end\n  c[Loose]\n  a --> b\n");
  const lanes = new Map(scene.items.filter((it) => it.kind.includes("pele-lane")).map((it) => [it.id, source(it)]));
  assert.deepEqual(Object.fromEntries(lanes), {
    Finance: { line: 2, end: 4, symbol: "Finance" },
    ops: { line: 5, end: 7, symbol: "ops" },
    __swimlane_default__: {},
  });
});

const CLASS = `classDiagram
  Animal <|-- Duck : inherits
  class Animal {
    +int age
  }
  Animal --() Walks
  note for Duck "quacks"
  namespace Zoo {
    class Keeper
  }
  Keeper --> Animal : feeds
`;

test("class diagram items know their line, name and ends", () => {
  const { scene } = mermaidScene(CLASS);
  const of = (kind) => find(scene, (it) => it.kind.split(" ").includes(kind));
  // A class comes from its own statement, over its body, not the relation that names it first.
  assert.deepEqual(find(scene, (it) => it.id === "Animal" && it.kind.includes("pele-class")), [{ line: 3, end: 5, symbol: "Animal" }]);
  assert.deepEqual(find(scene, (it) => it.id === "Duck" && it.kind.includes("pele-class")), [{ line: 2, symbol: "Duck" }]);
  assert.deepEqual(of("pele-relation"), [
    { line: 2, from: "Animal", to: "Duck" },
    { line: 6, from: "Animal", to: "Walks" },
    { line: 11, from: "Keeper", to: "Animal" },
  ]);
  // A lollipop interface comes from the relation that draws it.
  assert.deepEqual(of("pele-interface"), [{ line: 6, symbol: "Walks" }]);
  assert.deepEqual(of("pele-namespace"), [{ line: 8, end: 10, symbol: "Zoo" }]);
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-node") && it.kind.includes("pele-note")), [{ line: 7 }]);
});

test("a namespace made on the way to a dotted name comes from the first statement that names it", () => {
  const { scene } = mermaidScene("classDiagram\n  namespace Company.Engineering.Backend {\n    class Developer\n  }\n");
  const spaces = new Map(scene.items.filter((it) => it.kind.includes("pele-namespace")).map((it) => [it.id, source(it)]));
  assert.deepEqual(Object.fromEntries(spaces), {
    Company: { line: 2, symbol: "Company" },
    "Company.Engineering": { line: 2, symbol: "Engineering" },
    "Company.Engineering.Backend": { line: 2, end: 4, symbol: "Company.Engineering.Backend" },
  });
});

const STATE = `stateDiagram-v2
  [*] --> A
  A --> [*]
  state B {
    [*] --> C
    C --> [*]
  }
  A --> B
  note right of A : hi
  state "Long name" as D
  D --> A : back
`;

test("state diagram items know their line, name and ends; a start or an end is written [*]", () => {
  const { scene } = mermaidScene(STATE);
  const node = (id) => find(scene, (it) => it.id === id && !it.kind.includes("label"));
  assert.deepEqual(node("A"), [{ line: 2, symbol: "A" }]);
  // Defined by a statement of its own, not by the transition that names it after.
  assert.deepEqual(node("D"), [{ line: 10, symbol: "D" }]);
  assert.deepEqual(node("B"), [{ line: 4, end: 7, symbol: "B" }]);
  assert.deepEqual(["root_start", "root_end", "B_start", "B_end"].map(node), [
    [{ line: 2, symbol: "[*]" }], [{ line: 3, symbol: "[*]" }], [{ line: 5, symbol: "[*]" }], [{ line: 6, symbol: "[*]" }],
  ]);
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-transition")), [
    { line: 2, from: "[*]", to: "A" },
    { line: 3, from: "A", to: "[*]" },
    { line: 5, from: "[*]", to: "C" },
    { line: 6, from: "C", to: "[*]" },
    { line: 8, from: "A", to: "B" },
    { line: 11, from: "D", to: "A" },
  ]);
  // A note is not its state: it and its line come from the note's own line, with no name.
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-note")), [{ line: 9 }, { line: 9 }]);
});

const ER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string name
  }
  ORDER ||--|{ LINE : contains
  PRODUCT
`;

test("ER diagram items know their line, name and ends", () => {
  const { scene } = mermaidScene(ER);
  // An entity comes from its own statement, over its block, else from the relationship that names it first.
  assert.deepEqual(find(scene, (it) => it.kind.includes("pele-entity")), [
    { line: 3, end: 5, symbol: "CUSTOMER" },
    { line: 2, symbol: "ORDER" },
    { line: 6, symbol: "LINE" },
    { line: 7, symbol: "PRODUCT" },
  ]);
  assert.deepEqual(find(scene, (it) => it.kind.startsWith("pele-edge") && !it.kind.includes("label")), [
    { line: 2, from: "CUSTOMER", to: "ORDER" },
    { line: 6, from: "ORDER", to: "LINE" },
  ]);
});

test("across the corpus, each item's lines hold the names it carries, for every type that records them", async () => {
  const { default: corpus } = await import("./fixtures/corpus.js");
  let checked = 0;
  for (const type of Object.keys(corpus)) {
    for (const src of corpus[type]) {
      let scene;
      try {
        ({ scene } = mermaidScene(src));
      } catch {
        continue;
      }
      const lines = src.split("\n");
      for (const it of scene.items) {
        if (!it.line) continue;
        const text = lines.slice(it.line - 1, it.end ?? it.line).join("\n");
        const names = it.from !== undefined ? [it.from, it.to] : it.symbol !== undefined ? [it.symbol] : [];
        assert.ok(names.every((w) => text.includes(w)), `${type} ${it.id} lines ${it.line}-${it.end ?? it.line}: ${text}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 3000, `${checked} items checked`);
});

// Each type, by an example: [id, a word of its kind, where it is written]. An empty
// source means the part is written nowhere, so it says no line rather than a near one.
const EXAMPLES = {
  c4: [
    'C4Context\n  Person(a, "Alice")\n  System_Boundary(sb, "Shop") {\n    System(s1, "Old")\n  }\n  System(s1, "New", "multi\nline")\n  Rel(a, s1, "Uses")\n  Rel(a, s1, "Uses again")\n',
    [["sb", "pele-cluster", { line: 3, end: 5, symbol: "sb" }], ["s1", "pele-node", { line: 6, end: 7, symbol: "s1" }],
      ["a-s1", "pele-edge", { line: 9, from: "a", to: "s1" }], ["a", "pele-node", { line: 2, symbol: "a" }]],
  ],
  requirement: [
    "requirementDiagram\nrequirement r {\n  id: 1\n}\nrequirement r {\n  id: 2\n}\nelement e {\n  type: sim\n}\nr <- satisfies - e\n",
    [["r", "pele-requirement", { line: 2, end: 4, symbol: "r" }], ["e", "pele-element", { line: 8, end: 10, symbol: "e" }],
      ["e-r-0", "pele-relationship", { line: 11, from: "e", to: "r" }]],
  ],
  wardley: [
    'wardley-beta\nanchor Business [0.95, 0.63]\ncomponent "Cup of Tea" [0.79, 0.61]\ncomponent Database [0.40, 0.60]\npipeline Database {\n  component SQL DB [0.50]\n}\nBusiness -> "Cup of Tea"\nevolve Database 0.7\nevolve Database 0.8\n',
    [["Business", "anchor", { line: 2, symbol: "Business" }], ["Business-Cup of Tea", "pele-edge", { line: 8, from: "Business", to: "Cup of Tea" }],
      ["Database", "pele-wardley-pipeline", { line: 5, end: 7, symbol: "Database" }], ["Database_SQL DB", "pipeline-component", { line: 6, symbol: "SQL DB" }],
      ["Database", "trend", { line: 10, symbol: "Database" }]],
  ],
  railroad: [
    'railroad-ebnf-beta\nexpr = term\n     , { "+" , term }\n     ;\nterm = "x" ;\n',
    [["expr", "pele-rule", { line: 2, end: 4, symbol: "expr" }], ["term", "pele-rule", { line: 5, symbol: "term" }]],
  ],
  agentflow: [
    'agentflow-beta TB\n  flow f["F"]\n    a["A"]@{\n      shape: tool\n    }\n  end\n  a --> b\n  b@{ label: "B2" }\n',
    [["f", "pele-cluster", { line: 2, end: 6, symbol: "f" }], ["a", "pele-node", { line: 3, end: 5, symbol: "a" }],
      ["L_a_b_0", "pele-edge", { line: 7, from: "a", to: "b" }], ["b", "pele-node", { line: 8, symbol: "b" }]],
  ],
  cynefin: [
    'cynefin-beta\n  complex\n    "A"\n    "B"\n  complex --> chaotic : "x"\n',
    [["complex", "pele-cynefin-domain", { line: 2, end: 4, symbol: "complex" }], ["complex-chaotic", "pele-edge", { line: 5, from: "complex", to: "chaotic" }],
      ["chaotic", "pele-cynefin-domain", { line: 5, symbol: "chaotic" }]],
  ],
  eventmodeling: [
    "eventmodeling\ntf 01 evt A\ntf 02 ui B\nrf 03 rmo C ->> 01\nnote 02 {\n  n\n}\n",
    [["01", "pele-node", { line: 2, symbol: "01" }], ["01-03", "pele-edge", { line: 4, from: "01", to: "03" }], ["01-02", "pele-edge", {}],
      ["02", "pele-em-note", { line: 5, end: 7 }]],
  ],
  usecase: [
    'usecase-beta\nCustomer --> Login\nactor Customer\nLogin("Sign in")\n"Reset password"\nsystemBoundary Shop\n  Browse\nend\nnote for Login "Needs an account"\n',
    [["Customer", "pele-actor", { line: 3, symbol: "Customer" }], ["Reset_password", "pele-usecase", { line: 5, symbol: "Reset password" }],
      ["Shop", "pele-cluster", { line: 6, end: 8, symbol: "Shop" }], ["edge-0", "pele-edge", { line: 2, from: "Customer", to: "Login" }]],
  ],
  block: [
    'block-beta\n  columns 2\n  a b\n  block:grp\n    c["Cee"]\n  end\n  a["Ay"] --> c\n',
    [["a", "pele-node", { line: 7, symbol: "a" }], ["b", "pele-node", { line: 3, symbol: "b" }], ["grp", "pele-cluster", { line: 4, end: 6, symbol: "grp" }],
      ["1-a-c", "pele-edge", { line: 7, from: "a", to: "c" }]],
  ],
  architecture: [
    'architecture-beta\n  group api(cloud)[API]\n  service db(database)["Main\n  DB"] in api\n  service server(server)[Server] in api\n  db:L -- R:server\n',
    [["api", "pele-cluster", { line: 2, symbol: "api" }], ["db", "pele-service", { line: 3, end: 4, symbol: "db" }],
      ["db-server", "pele-edge", { line: 6, from: "db", to: "server" }]],
  ],
  gantt: [
    "gantt\n  dateFormat YYYY-MM-DD\n  section Dev\n    Build :b1, 2024-01-01, 3d\n  section Test\n    Check : 2d\n",
    [["b1", "pele-task", { line: 4, symbol: "b1" }], ["task1", "pele-task", { line: 6 }]],
  ],
  git: [
    'gitGraph\n  commit id: "init"\n  branch feature\n  commit msg: "two\nlines"\n',
    [["main", "pele-branch", {}], ["feature", "pele-branch", { line: 3, symbol: "feature" }], ["init", "pele-commit", { line: 2, symbol: "init" }]],
  ],
  timeline: [
    "timeline\n  title T\n  section Early\n    2004 : Facebook\n         : Google\n  2005 : YouTube\n",
    [],
  ],
  kanban: [
    "kanban\n  todo[Todo]\n    c1[Card]@{\n      assigned: bob\n    }\n    Bare card\n",
    [["todo", "pele-", { line: 2, symbol: "todo" }], ["c1", "pele-", { line: 3, end: 5, symbol: "c1" }]],
  ],
  mindmap: [
    'mindmap\n  root((Root))\n    A\n    b["two\nlines"]\n    ::icon(fa fa-book)\n',
    [["b", "pele-node", { line: 4, end: 5, symbol: "b" }]],
  ],
  pie: ['pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Dogs" : 10\n', []],
  sankey: [
    'sankey-beta\n\n%% c\n  Coal,Power,10\n"He said ""hi""",Power,5\n',
    [["Power", "pele-sankey-node", { line: 4, symbol: "Power" }]],
  ],
  radar: [
    'radar-beta\n  axis m["Math"], s["Sci"]\n  axis e["Eng"]\n  curve a{1, 2, 3}\n  curve b{\n    m: 7,\n    s: 7,\n    e: 8\n  }, c{1, 2, 3}\n',
    [],
  ],
  venn: ['venn-beta\n  set A["Apples"]\n    text a1["Fuji"]\n  set "B"\n  set A:20\n  union A, B["Both"]\n', []],
  treeview: ["treeView-beta\n├── src/\n│   ├── index.ts\n│   └── lib/\n└── README.md\n", []],
};

test("every type says where its parts are written, and nothing for a part written nowhere", () => {
  for (const [type, [src, want]] of Object.entries(EXAMPLES)) {
    const { scene } = mermaidScene(src);
    const items = scene.items.filter((it) => it.id);
    // Every example has parts with lines, whatever else it checks.
    assert.ok(items.some((it) => it.line), `${type}: no item has a line`);
    for (const [id, kind, expected] of want) {
      const it = items.find((x) => x.id === id && x.kind.includes(kind));
      assert.ok(it, `${type}: no ${kind} ${id} in ${items.map((x) => `${x.kind}#${x.id}`).join(", ")}`);
      assert.deepEqual(source(it), expected, `${type} ${kind} ${id}`);
    }
  }
});
