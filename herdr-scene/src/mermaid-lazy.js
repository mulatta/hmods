// Mermaid -> scene for mods. Herdr keeps every loaded generation of a mod in
// one script heap, and pele's code for all its diagram types is most of the
// mod: each type's code loads when a text first needs it (`prepare`), so
// that heap holds only the kinds in use. "pele-lazy" is pele's lazy entry,
// aliased by scripts/build.sh.
import * as pele from "pele-lazy";
import { sceneWith } from "./mermaid-scene.js";

/** Loads the diagram type the text needs; mermaidScene() can draw it after. */
export async function prepare(source) {
  let type = null;
  try {
    type = pele.detectType(source);
  } catch {
    // mermaidScene() reports what is wrong with the text.
  }
  await pele.load(type);
}

/**
 * Throws for a type not yet prepared, as for any text pele cannot draw.
 * @param {string} source  Mermaid text
 * @returns {{ scene: import("./scene.js").Scene, type: string }}
 */
export function mermaidScene(source, options = {}) {
  return sceneWith(pele, source, options);
}
