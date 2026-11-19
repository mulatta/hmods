// Stand-ins for the host's element and path builders, so a mod's drawing runs
// outside Herdr. Nothing is drawn: each builder call is counted, since in the
// app every one of them is a call into the host.
export const counts = { elements: 0, calls: 0, paths: 0, pathCmds: 0 };

// Tests that look at what was set on an element turn this on: each element
// then keeps its calls as [name, ...args].
let recording = false;
export function record(on) {
  recording = on;
}

export function resetCounts() {
  for (const k of Object.keys(counts)) counts[k] = 0;
}

// Builders answer any method by returning themselves. A method is made the
// first time it is asked for and kept on the prototype, so later calls are
// plain calls: a Proxy on every call would cost more than the drawing measured.
function anyMethod(proto, count) {
  return new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string" || key === "then") return undefined; // not a promise
      const f = function (...args) {
        counts[count]++;
        if (recording) (this.log ??= []).push([key, ...args]);
        return this;
      };
      Object.defineProperty(proto, key, { value: f });
      return f;
    },
  });
}

// An element: `when` runs its branch as the host does, and children are kept
// so nothing is dropped early.
class Element {
  constructor() {
    counts.elements++;
    this.kids = [];
    // Own, so the any-method prototype never answers for it.
    this.log = null;
  }
  when(cond, f) {
    counts.calls++;
    return cond ? f(this) : this;
  }
  child(c) {
    counts.calls++;
    this.kids.push(c);
    return this;
  }
  children(cs) {
    counts.calls++;
    for (const c of cs) this.kids.push(c);
    return this;
  }
}
Object.setPrototypeOf(Element.prototype, anyMethod(Element.prototype, "calls"));

class Path {
  constructor() {
    this.log = null;
  }

  build() {
    counts.paths++;
    return { built: true };
  }
}
Object.setPrototypeOf(Path.prototype, anyMethod(Path.prototype, "pathCmds"));

const element = () => new Element();
export const div = element;
export const svg = element;
export const PathBuilder = { fill: () => new Path(), stroke: () => new Path() };

export class View {}

globalThis.window ??= {};
globalThis.window.paint_path = () => element();
