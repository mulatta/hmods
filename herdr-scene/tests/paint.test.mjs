import assert from "node:assert/strict";
import test from "node:test";
import { cssColor, fontOf, paletteFromTheme, peleCss, radiusOf, resolvePaint, themeVars, weightOf } from "../src/index.js";

const THEME = {
  background: "#101010", foreground: "#eeeeee", muted: "#999999", surface: "#202020",
  raised: "#303030", border: "#404040", accent: "#3366ff",
};

test("a theme gives pele's CSS variables, and a scene's vars say what its paints mean", () => {
  const p = paletteFromTheme(THEME);
  assert.equal(resolvePaint("var(--_s)", p), "#202020");
  assert.equal(resolvePaint("var(--_c)", p), "#3366ff");
  assert.equal(resolvePaint("currentColor", p), "#eeeeee");
  // A variable the theme leaves to pele keeps the default the paint names.
  assert.equal(resolvePaint("var(--pele-series-1,#4c78a8)", p), "#4c78a8");
  assert.equal(resolvePaint("var(--pele-fg-on-dark,#fff)", p), "#ffffff");
});

test("a diagram's palette colors its series over the host's", () => {
  const vars = { "--_fg": "var(--pele-fg,#1f1f1f)", "--pele-series-1": "red", "--pele-series-2": "#00ff00" };
  const p = paletteFromTheme(THEME, { vars, css: { "pele-series-1": "#123456", "pele-series-3": "#abcdef" } });
  assert.equal(resolvePaint("var(--pele-series-1,#4c78a8)", p), "#ff0000");
  assert.equal(resolvePaint("var(--pele-series-2,#4c78a8)", p), "#00ff00");
  assert.equal(resolvePaint("var(--pele-series-3,#4c78a8)", p), "#abcdef");
});

test("pele CSS sets variables, by appearance where it says so", () => {
  const css = `
    /* a theme for diagrams */
    :root { --pele-accent: #205ea6; --pele-surface: rgb(242, 240, 229); color: red; }
    @media (prefers-color-scheme: dark) { :root { --pele-accent: #4385be; } }
    @media (prefers-color-scheme: light) { .pele { --pele-border: #cecdc3 } }
    @media print { :root { --pele-bg: #ffffff; } }
    --pele-series-1: tomato;
  `;
  assert.deepEqual(peleCss(css, false), { "pele-accent": "#205ea6", "pele-surface": "#f2f0e5", "pele-border": "#cecdc3", "pele-series-1": "#ff6347" });
  assert.deepEqual(peleCss(css, true), { "pele-accent": "#4385be", "pele-surface": "#f2f0e5", "pele-series-1": "#ff6347" });
  // pele CSS wins over the theme, as page CSS sets what pele's defaults leave open.
  const p = paletteFromTheme(THEME, { css: peleCss(css, true) });
  assert.equal(resolvePaint("var(--_c)", p), "#4385be");
  assert.equal(resolvePaint("var(--_s)", p), "#f2f0e5");
});

test("values that are not colors are left out", () => {
  assert.deepEqual(peleCss("--pele-bg: url(x); --pele-fg: expression(1); --pele-line: nonsense; --pele-muted: #abc"), { "pele-muted": "#aabbcc" });
});

test("pele CSS sets corners, weights and fonts, which a scene's vars name", () => {
  const css = peleCss(`:root {
    --pele-radius: 6px; --pele-bold-weight: 600; --pele-title-weight: normal;
    --pele-font: "Inter", sans-serif; --pele-font-mono: url(x); --pele-heading-weight: heavy;
  }`);
  assert.deepEqual(css, { "pele-radius": "6", "pele-bold-weight": "600", "pele-title-weight": "400", "pele-font": '"Inter", sans-serif' });
  const vars = {
    "--_r": "var(--pele-radius,4px)", "--_w": "var(--pele-bold-weight,bold)", "--_tw": "var(--pele-title-weight,bold)",
    "--_hw": "var(--pele-heading-weight,bold)", "--_f": "var(--pele-font,sans-serif)", "--_fm": "var(--pele-font-mono,Iosevka, monospace)",
  };
  const set = paletteFromTheme(THEME, { vars, css });
  assert.deepEqual([radiusOf(set, "--_r"), weightOf(set, "--_w", 700), weightOf(set, "--_tw", 700), weightOf(set, "--_hw", 700)], [6, 600, 400, 700]);
  assert.deepEqual([fontOf(set, "--_f"), fontOf(set, "--_fm")], ['"Inter", sans-serif', "Iosevka, monospace"]);
  // Left unset, pele's defaults; a bare generic family is the host's own font.
  const plain = paletteFromTheme(THEME, { vars });
  assert.deepEqual([radiusOf(plain, "--_r"), weightOf(plain, "--_w", 700), fontOf(plain, "--_f")], [4, 700, null]);
  // Scenes from before these variables keep pele's defaults.
  const old = paletteFromTheme(THEME);
  assert.deepEqual([radiusOf(old, "--_r"), weightOf(old, "--_tw", 700), fontOf(old, "--_fm")], [4, 700, null]);
});

test("CSS colors in hsl(), oklch() and color-mix() are read as CSS defines them", () => {
  assert.equal(cssColor("hsl(120, 100%, 25%)"), "#008000");
  assert.equal(cssColor("hsl(0.5turn 100 50 / 50%)"), "#00ffff80");
  assert.equal(cssColor("hsla(240deg, 100%, 50%, 0.5)"), "#0000ff80");
  assert.equal(cssColor("oklch(62.796% 0.25768 29.234)"), "#ff0000");
  assert.equal(cssColor("oklch(0.5 0 0)"), "#636363");
  // Outside sRGB, each channel is clipped.
  assert.equal(cssColor("oklch(0.9 0.4 140)"), "#00ff00");
  assert.equal(cssColor("color-mix(in srgb, red 25%, blue)"), "#4000bf");
  assert.equal(cssColor("color-mix(in oklab, white, black)"), "#636363");
  // Percentages short of 100% leave the rest transparent.
  assert.equal(cssColor("color-mix(in srgb, red 30%, blue 30%)"), "#80008099");
  assert.equal(cssColor("color-mix(in oklch, hsl(0 100% 50%), oklch(0.5 0 0))"), cssColor("color-mix(in oklch, red 50%, #636363 50%)"));
  for (const bad of ["hsl(1 2)", "oklch(0.5 0.1 url(x))", "color-mix(in lab, red, blue)", "color-mix(in srgb, red, blue, green)", "color-mix(in srgb, red -10%, blue)"]) {
    assert.equal(cssColor(bad), null, bad);
  }
});

test("pele CSS values take var(): its own custom properties, then the theme's", () => {
  const base = themeVars(THEME);
  const css = peleCss(`:root {
    --blue: oklch(0.55 0.15 255); --pele-accent: var(--blue);
    --pele-surface: color-mix(in srgb, var(--pele-accent) 20%, var(--pele-bg));
    --pele-border: var(--missing, var(--pele-fg));
    --pele-muted: var(--missing);
    --pele-line: var(--pele-series-1); --pele-series-1: var(--pele-line);
    --pele-radius: var(--r, 6px);
  }`, false, base);
  assert.deepEqual(css, {
    "pele-accent": cssColor("oklch(0.55 0.15 255)"),
    "pele-surface": cssColor(`color-mix(in srgb, ${cssColor("oklch(0.55 0.15 255)")} 20%, #101010)`),
    "pele-border": "#eeeeee",
    "pele-radius": "6",
  });
});

test("a later stylesheet's pele CSS goes over an earlier's", () => {
  const global = ":root { --pele-accent: #205ea6; --pele-bg: #fffcf0; --brand: red; }";
  const file = ":root { --pele-accent: var(--brand); } @media (prefers-color-scheme: dark) { :root { --pele-bg: #100f0f } }";
  assert.deepEqual(peleCss([global, file], false), { "pele-accent": "#ff0000", "pele-bg": "#fffcf0" });
  assert.deepEqual(peleCss([global, file], true), { "pele-accent": "#ff0000", "pele-bg": "#100f0f" });
  // A brace left open in one stylesheet stays in it.
  assert.deepEqual(peleCss([":root { --pele-bg: #000", ":root { --pele-fg: #fff }"]), { "pele-bg": "#000000", "pele-fg": "#ffffff" });
});
