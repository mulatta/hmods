// Mermaid -> scene through a pele module: the full bundle (./mermaid.js) or
// one that loads diagram types as they are needed (./mermaid-lazy.js).

/**
 * Items carry where the author wrote them (line, symbol, ends) for the types
 * pele records it for.
 * @param {typeof import("../build/pele.js")} pele
 * @param {string} source  Mermaid text
 * @returns {{ scene: import("./scene.js").Scene, type: string }}
 */
export function sceneWith(pele, source, options = {}) {
  const r = pele.renderScene(source, options);
  return { scene: r.scene, type: r.type };
}
