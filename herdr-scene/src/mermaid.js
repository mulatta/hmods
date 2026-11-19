// Mermaid -> scene with every diagram type at hand, for Node and tests.

// The pele fork, bundled by scripts/build.sh (its TypeScript uses const enums,
// which Node cannot strip, so tests and mods share the built module).
import * as pele from "../build/pele.js";
import { sceneWith } from "./mermaid-scene.js";

/**
 * @param {string} source  Mermaid text
 * @returns {{ scene: import("./scene.js").Scene, type: string }}
 */
export function mermaidScene(source, options = {}) {
  return sceneWith(pele, source, options);
}
