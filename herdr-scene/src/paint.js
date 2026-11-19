// Paint tokens -> concrete "#rrggbbaa" colors. Pele paints with CSS
// variables: its private --_x ones, which a scene's `vars` define in terms of
// the public --pele-* ones (var(--pele-surface,#f3f3f3)), --pele-* ones with a
// default, and color-mix(). A palette holds what the host sets those
// variables to, as a page with pele's CSS would; anything it cannot read falls
// back to the foreground so a diagram never draws invisible.

/**
 * @typedef {Record<string, string>} Palette  variable name (without "--") -> "#rrggbb[aa]"
 */

// What pele's private variables stand for when a scene does not say (scenes
// before version 4, and scenes read from SVG).
export const PELE_VARS = {
  "--_bg": "var(--pele-bg,#fff)",
  "--_fg": "var(--pele-fg,#1f1f1f)",
  "--_m": "var(--pele-muted,#6e6e6e)",
  "--_l": "var(--pele-line,#1f1f1f)",
  "--_s": "var(--pele-surface,#f3f3f3)",
  "--_a": "var(--pele-surface-alt,#e6e6e6)",
  "--_b": "var(--pele-border,#8a8a8a)",
  "--_c": "var(--pele-accent,#5b7bd5)",
  "--_r": "var(--pele-radius,4px)",
  "--_w": "var(--pele-bold-weight,bold)",
  "--_tw": "var(--pele-title-weight,bold)",
  "--_hw": "var(--pele-heading-weight,bold)",
  "--_f": "var(--pele-font,sans-serif)",
  "--_fm": "var(--pele-font-mono,monospace)",
};

// What a variable holds, by name; the rest are colors.
const kindOf = (name) =>
  /^(?:--_r|-?-?pele-radius)$/.test(name) ? "length"
    : /^(?:--_(?:w|tw|hw)|-?-?pele-[\w-]*weight)$/.test(name) ? "weight"
    : /^(?:--_fm?|-?-?pele-font(?:-mono)?)$/.test(name) ? "font"
    : "color";

// A list of font names, quoted or not, and nothing that could end a declaration.
const FAMILY = String.raw`(?:"[^"'\\\n<>{}();:@]*"|'[^"'\\\n<>{}();:@]*'|[\p{L}\p{N}_-][\p{L}\p{N}_ .-]*)`;
const RE_FAMILIES = new RegExp(String.raw`^\s*${FAMILY}(?:\s*,\s*${FAMILY})*\s*$`, "u");

// A value read as its kind of variable holds it ("6", "600", a font list), or null.
function valueOf(kind, v) {
  v = v.trim();
  if (kind === "length") {
    const m = v.match(/^(\d+(?:\.\d+)?)(?:px)?$/);
    return m ? String(Number(m[1])) : null;
  }
  if (kind === "weight") {
    if (v === "bold") return "700";
    if (v === "normal") return "400";
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 1000 && /^\d+$/.test(v) ? v : null;
  }
  if (kind === "font") return RE_FAMILIES.test(v) ? v : null;
  return cssColor(v);
}

// A variable's value as set: a var() looks up `values` by name, else takes its fallback.
function rawOf(v, values, depth = 0) {
  if (depth > 8) return null;
  const m = v.trim().match(/^var\(\s*--([\w-]+)\s*(?:,\s*(.+))?\)$/s);
  if (!m) return v.trim();
  if (values[m[1]] !== undefined) return values[m[1]];
  return m[2] === undefined ? null : rawOf(m[2], values, depth + 1);
}

// CSS named colors.
const NAMED = Object.fromEntries(
  ("aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 " +
    "blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 " +
    "chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b " +
    "darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b " +
    "darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f " +
    "darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 " +
    "deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 " +
    "fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f " +
    "grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa " +
    "lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff " +
    "lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a " +
    "lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 " +
    "lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd " +
    "mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a " +
    "mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 " +
    "navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 " +
    "palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 " +
    "peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f " +
    "royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d " +
    "silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f " +
    "steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 " +
    "white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32")
    .split(" ")
    .flatMap((v, i, a) => (i % 2 ? [] : [[v, "#" + a[i + 1]]])),
);

const byte = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

// "#rrggbb[aa]" <-> [r, g, b, alpha], each 0..1.
const hexOf = ([r, g, b, a]) => "#" + byte(r * 255) + byte(g * 255) + byte(b * 255) + (a < 1 ? byte(a * 255) : "");
const rgbaOf = (hex) => [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7), hex.slice(7, 9) || "ff"].map((h) => parseInt(h, 16) / 255);

// Splits at the commas outside parentheses.
function splitTop(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) out.push(s.slice(start, i).trim()), (start = i + 1);
  }
  out.push(s.slice(start).trim());
  return out;
}

const RE_NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const RE_FN = new RegExp(String.raw`^(hsla?|oklch)\(\s*(${RE_NUM}(?:deg|rad|grad|turn|%)?(?:\s*[\s,/]\s*${RE_NUM}%?){2,3})\s*\)$`);
// A color-mix() side: the color and its percentage, before or after it.
const RE_MIX_SIDE = new RegExp(String.raw`^(?:(${RE_NUM})%\s+)?(.+?)(?:\s+(${RE_NUM})%)?$`, "s");
const DEG = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360, "": 1 };
const clip = (x) => Math.max(0, Math.min(1, x));

// A number, or a percentage of `pct`.
const numOf = (tok, pct = 1) => (tok.endsWith("%") ? (parseFloat(tok) / 100) * pct : parseFloat(tok));
const hueOf = (tok) => {
  const m = tok.match(/^(.*?)(deg|rad|grad|turn)?$/);
  return (((parseFloat(m[1]) * DEG[m[2] ?? ""]) % 360) + 360) % 360;
};
const alphaOf = (tok) => (tok === undefined ? 1 : clip(numOf(tok)));

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// OKLab <-> linear sRGB, as CSS Color 4 gives them.
function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const toLinear = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));

// Mixing spaces: to and from sRGB, and which channel is a hue.
const SPACES = {
  srgb: { to: (c) => c, from: (c) => c },
  "srgb-linear": { to: (c) => c.map(toLinear), from: (c) => c.map(fromLinear) },
  oklab: { to: (c) => linearToOklab(...c.map(toLinear)), from: (c) => oklabToLinear(...c).map(fromLinear) },
  oklch: {
    to: (c) => {
      const [L, a, b] = linearToOklab(...c.map(toLinear));
      return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
    },
    from: ([L, C, H]) => oklabToLinear(L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)).map(fromLinear),
    hue: 2,
  },
};

// color-mix(in <space>, <color> [<p>%], <color> [<p>%]), with CSS Color 5's
// percentages and premultiplied alpha; hues take the shorter way round.
function mixOf(inner, depth) {
  const parts = splitTop(inner);
  const space = SPACES[parts[0].match(/^in\s+([\w-]+)$/)?.[1]];
  if (!space || parts.length !== 3) return null;
  const sides = parts.slice(1).map((p) => {
    const m = p.match(RE_MIX_SIDE);
    const c = m && cssColor(m[2], depth + 1);
    return c && { c: rgbaOf(c), p: m[1] ?? m[3] };
  });
  if (!sides[0] || !sides[1]) return null;
  let [p1, p2] = sides.map((s) => (s.p === undefined ? undefined : Number(s.p) / 100));
  if (p1 === undefined && p2 === undefined) p1 = p2 = 0.5;
  else if (p1 === undefined) p1 = 1 - p2;
  else if (p2 === undefined) p2 = 1 - p1;
  const sum = p1 + p2;
  if (!(p1 >= 0 && p2 >= 0 && sum > 0)) return null;
  const [w1, w2] = [p1 / sum, p2 / sum];
  const [a, b] = sides.map((s) => space.to(s.c.slice(0, 3)));
  if (space.hue !== undefined) {
    const d = b[space.hue] - a[space.hue];
    if (d > 180) a[space.hue] += 360;
    else if (d < -180) b[space.hue] += 360;
  }
  const [a1, a2] = [sides[0].c[3], sides[1].c[3]];
  const alpha = a1 * w1 + a2 * w2;
  const mixed = a.map((x, i) => (i === space.hue ? x * w1 + b[i] * w2 : alpha ? (x * a1 * w1 + b[i] * a2 * w2) / alpha : 0));
  if (space.hue !== undefined) mixed[space.hue] %= 360;
  return hexOf([...space.from(mixed).map(clip), alpha * Math.min(1, sum)]);
}

/**
 * A literal CSS color -> "#rrggbb[aa]", else null: hex, a name, rgb()/rgba(),
 * hsl()/hsla(), oklch() (clipped to sRGB per channel) and color-mix() of those.
 */
export function cssColor(v, depth = 0) {
  v = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(v)) return "#" + [...v.slice(1)].map((c) => c + c).join("");
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v;
  if (NAMED[v]) return NAMED[v];
  if (depth > 8) return null;
  if (v.startsWith("color-mix(") && v.endsWith(")")) return mixOf(v.slice(10, -1), depth);
  const f = v.match(RE_FN);
  if (f) {
    const t = f[2].split(/\s*[\s,/]\s*/);
    const rgb = f[1] === "oklch"
      ? SPACES.oklch.from([numOf(t[0]), numOf(t[1], 0.4), hueOf(t[2])])
      : hslToRgb(hueOf(t[0]), clip(numOf(t[1], 100) / 100), clip(numOf(t[2], 100) / 100));
    return hexOf([...rgb.map(clip), alphaOf(t[3])]);
  }
  const m = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  const ch = (x) => (x.endsWith("%") ? parseFloat(x) * 2.55 : parseFloat(x));
  const alpha = m[4] === undefined ? "" : byte((m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) * 255);
  return "#" + byte(ch(m[1])) + byte(ch(m[2])) + byte(ch(m[3])) + (alpha === "ff" ? "" : alpha);
}

const fgOf = (palette) => palette._fg ?? palette["pele-fg"] ?? null;

/** A paint token -> "#rrggbb[aa]", or null for no paint. */
export function resolvePaint(v, palette, depth = 0) {
  if (!v) return null;
  v = v.trim();
  if (v === "none" || v === "transparent") return null;
  if (depth > 8) return fgOf(palette);
  if (v === "currentColor") return fgOf(palette);
  let m = v.match(/^var\(\s*--([\w-]+)\s*\)$/);
  if (m) return palette[m[1]] ?? fgOf(palette);
  m = v.match(/^var\(\s*--([\w-]+)\s*,\s*(.+)\)$/);
  if (m) return palette[m[1]] ?? resolvePaint(m[2], palette, depth + 1);
  m = v.match(/^color-mix\(\s*in\s+\w+\s*,\s*(var\([^)]*\)|#[0-9a-f]+|\w+)/i);
  if (m) return resolvePaint(m[1], palette, depth + 1);
  return cssColor(v) ?? fgOf(palette);
}

/** "#rrggbb[aa]" with its alpha multiplied by `a`. */
export function withAlpha(c, a) {
  if (!c || !(a < 1)) return c;
  const base = c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1;
  return c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a * base)) * 255).toString(16).padStart(2, "0");
}

/**
 * Pele's --pele-* variables a Herdr theme() sets: background, foreground,
 * muted, surface, raised, input/border and accent.
 * @param {Record<string, string>} t
 * @returns {Palette}
 */
export function themeVars(t) {
  return {
    "pele-bg": t.background, "pele-fg": t.foreground, "pele-muted": t.muted, "pele-line": withAlpha(t.foreground, 0.7),
    "pele-surface": t.surface, "pele-surface-alt": t.raised, "pele-border": t.input ?? t.border, "pele-accent": t.accent,
  };
}

/**
 * The palette for a scene: pele's --pele-* variables from a Herdr theme()
 * (see themeVars), then pele CSS over them (see peleCss), then the scene's own
 * `vars` read against those, as an SVG's root style is read against its page:
 * its private variables, and the series colors its diagram's palette sets.
 * @param {Record<string, string>} t
 * @param {{ vars?: Record<string, string>, css?: Palette }} [o]
 * @returns {Palette}
 */
export function paletteFromTheme(t, { vars = PELE_VARS, css = {} } = {}) {
  const pele = { ...themeVars(t), ...css };
  const palette = { ...pele };
  for (const [name, value] of Object.entries({ ...PELE_VARS, ...vars })) {
    if (!name.startsWith("--")) continue;
    const kind = kindOf(name);
    if (kind === "color") {
      const c = resolvePaint(value, pele);
      if (c) palette[name.slice(2)] = c;
    } else {
      const raw = rawOf(value, pele);
      const v = raw === null ? null : valueOf(kind, raw);
      if (v !== null) palette[name.slice(2)] = v;
    }
  }
  return palette;
}

/** A corner radius variable (`--_r`) in scene units, pele's 4 when unset. */
export function radiusOf(palette, name) {
  const v = Number(palette[name.replace(/^--/, "")]);
  return Number.isFinite(v) ? v : 4;
}

/** A weight variable (`--_w`, `--_tw`, `--_hw`) as a number, else `fallback`. */
export function weightOf(palette, name, fallback) {
  const v = Number(palette[name.replace(/^--/, "")]);
  return Number.isFinite(v) ? v : fallback;
}

/** A font variable (`--_f`, `--_fm`), or null where it is a bare generic family: the host's own font. */
export function fontOf(palette, name) {
  const v = palette[name.replace(/^--/, "")];
  return !v || /^(?:sans-serif|serif|monospace|system-ui|ui-monospace)$/.test(v.trim()) ? null : v;
}

// `v` with each var() replaced by what `lookup` gives its name, else its
// fallback; null when one has neither or they refer round in a cycle.
function substitute(v, lookup, seen = new Set()) {
  let out = "", i = 0;
  for (;;) {
    const at = v.indexOf("var(", i);
    if (at < 0) return out + v.slice(i);
    let depth = 1, end = at + 4;
    for (; end < v.length && depth; end++) depth += v[end] === "(" ? 1 : v[end] === ")" ? -1 : 0;
    if (depth) return null;
    const [name, ...rest] = splitTop(v.slice(at + 4, end - 1));
    const m = name.match(/^--([\w-]+)$/);
    if (!m) return null;
    let value = null;
    const given = seen.has(m[1]) ? undefined : lookup(m[1]);
    if (given !== undefined) value = substitute(given, lookup, new Set([...seen, m[1]]));
    if (value === null && rest.length) value = substitute(rest.join(","), lookup, seen);
    if (value === null) return null;
    out += v.slice(i, at) + value;
    i = end;
  }
}

/**
 * The --pele-* variables pele stylesheets set, for the given appearance:
 * declarations anywhere, those under @media (prefers-color-scheme: dark|light)
 * only for that appearance and those under any other @media never; a later
 * stylesheet's over an earlier's. A value's var() takes any custom property
 * they declare, else `base` (the theme's, see themeVars). Colors are literal
 * colors, --pele-radius a length in px, weights bold, normal or a number, and
 * fonts a list of families; anything else is left out.
 * @param {string | string[]} texts
 * @param {boolean} [dark]
 * @param {Palette} [base]
 * @param {(warning: {sheet: number, line: number, message: string}) => void} [warn]
 * @returns {Palette}
 */
export function peleCss(texts, dark = false, base = {}, warn) {
  const declared = new Map();
  const locations = warn && new Map();
  for (const [sheet, text] of [texts].flat().entries()) declare(text, dark, declared, locations, sheet);
  const out = {};
  for (const [name, raw] of declared) {
    if (!name.startsWith("pele-")) continue;
    const value = substitute(raw, (n) => declared.get(n) ?? base[n], new Set([name]));
    const v = value === null ? null : valueOf(kindOf(name), value);
    if (warn) {
      const location = locations.get(name);
      if (!PUBLIC_VARS.has(name)) warn({ ...location, message: `Unknown variable --${name}` });
      else if (v === null) warn({ ...location, message: `Cannot resolve --${name}: ${raw}` });
    }
    if (v !== null) out[name] = v;
  }
  return out;
}

const PUBLIC_VARS = new Set([
  ...Object.values(PELE_VARS).map((v) => v.match(/var\(--([^,]+)/)[1]),
  "pele-critical", "pele-fg-on-dark", "pele-fg-on-light",
  ...Array.from({ length: 8 }, (_, i) => `pele-series-${i + 1}`),
]);

// Puts the custom properties one stylesheet declares for the appearance into `into`.
function declare(text, dark, into, locations, sheet) {
  const original = String(text ?? "");
  const comments = [];
  let removed = 0;
  const src = original.replace(/\/\*[\s\S]*?\*\//g, (comment, offset) => {
    if (locations) comments.push({ at: offset - removed, length: comment.length });
    removed += comment.length;
    return "";
  });
  let commentIndex = 0, originalOffset = 0, line = 1, cursor = 0;
  const active = [true];
  let start = 0;
  const add = (decl) => {
    const m = decl.match(/^\s*--([\w-]+)\s*:\s*([^]*?)\s*(?:!important\s*)?$/);
    if (!m || !active[active.length - 1]) return;
    into.set(m[1], m[2]);
    if (locations) {
      const at = start + decl.indexOf("--");
      while (commentIndex < comments.length && comments[commentIndex].at <= at) originalOffset += comments[commentIndex++].length;
      while (cursor < at + originalOffset) if (original[cursor++] === "\n") line++;
      locations.set(m[1], { sheet, line });
    }
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = src.slice(start, i).trim();
      let on = active[active.length - 1];
      if (prelude.startsWith("@media")) {
        const scheme = prelude.match(/prefers-color-scheme\s*:\s*(dark|light)/);
        on = on && !!scheme && (scheme[1] === "dark") === dark;
      }
      active.push(on);
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      add(src.slice(start, i));
      if (ch === "}" && active.length > 1) active.pop();
      start = i + 1;
    }
  }
  add(src.slice(start));
}

// A dash period shorter than this many px cannot be seen as dashes.
const SEEN_DASH_PX = 2;

/**
 * A dash pattern (scene units) on screen at zoom `z`: in px, or, when a period
 * is too short to see, none, and the line's alpha scaled by how much of a
 * period is drawn, which is how fine dashes look. Each dash is tessellated on
 * its own, so a fine pattern costs thousands of pieces for that look.
 */
export function screenDash(dash, z) {
  if (!dash?.length) return { dash: null, alpha: 1 };
  let period = 0, on = 0;
  dash.forEach((d, i) => {
    period += d;
    if (i % 2 === 0) on += d;
  });
  if (dash.length % 2) on = period / 2; // an odd list repeats with on and off swapped
  if (period * z >= SEEN_DASH_PX) return { dash: dash.map((d) => d * z), alpha: 1 };
  return { dash: null, alpha: period > 0 ? on / period : 1 };
}
