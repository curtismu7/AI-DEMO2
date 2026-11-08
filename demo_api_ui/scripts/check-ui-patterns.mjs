#!/usr/bin/env node
/**
 * Static check of a routed page against the Ping UI Standard (AI-DEMO-Standalone/shared/
 * STANDALONE-UI-PATTERNS.md, re-created for this app in docs/ping-ui-primitives.md). Mirrors
 * AI-DEMO-Standalone/scripts/check-ui-patterns.sh.
 *
 * Two rule sets:
 *
 *   1. SHARED (always enforced, regardless of the allowlist): src/styles/ping-ui.css, everything in
 *      src/components/pingUi/, and the shared children that converted pages mount
 *      (components/privilege/PrivilegeLiveCheck.jsx/.css), listed in SHARED_FILES. One edit there
 *      reaches every converted page, so it is scanned once, on its own, and fails CI by itself.
 *
 *   2. PAGE, per routed page (the page's JSX plus the stylesheets it imports, following @import and
 *      CSS-modules `composes ... from`):
 *        P2   the simulation banner comes first: before the title band and before any section/card/button
 *        P9   exactly one primary button per view (a PrivilegeLiveCheck without buttonClassName is one)
 *        P7   every status chip has text (never a bare dot; {""}, {" "}, {null}, &nbsp; are not text)
 *        H3   no inline colour literal (hex, rgb/hsl/hwb/lab/lch/oklab/oklch) and no style={{ color/
 *             background/border/fontSize... }} on themeable props
 *        P9   no violet/indigo/purple colour, and no vertical colour token, on a button rule in CSS
 *        H2   no font size below 10px in CSS (font-size and the font shorthand; px, rem, em, pt, %,
 *             keywords, clamp/min/max/calc, and var() chains)
 *
 * What counts as a button rule: a selector that names a <button>, [type=button|submit|reset],
 * [role=button], any name containing "button"/"btn", or any class that the scanned JSX puts on a
 * <button>, on an element with role="button", on an <input type=button|submit>, on an <a>/<Link>
 * with a btn-style class, or passes as buttonClassName.
 *
 * What counts as violet/indigo: any colour literal (hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(),
 * oklch(), color(srgb|display-p3), a CSS named colour, or one nested in color-mix()/gradients) whose
 * hue is 235-300 deg with HSL saturation above 20% and chroma >= 0.12 (so near-black and near-white ink
 * is not flagged; Ping blue #12538d is hue 209), reached through any var() chain (all definitions of
 * a custom property in the scanned CSS, src/index.css and src/styles/ are considered).
 *
 * Advisory by default: it reports every routed page and exits 0 for them. It ENFORCES (exit 1) for the
 * routes listed in scripts/ui-pattern-converted.txt, for a listed route that no longer resolves, and
 * ALWAYS for the shared set. Convert a page, then add its route to that file in the same PR.
 *
 * It is a static heuristic, not a renderer. It still cannot see: a banner or button rendered by a child
 * component outside the scanned shared set (the unscanned children an enforced page imports are
 * listed as INFO); a colour inherited or set at runtime (the vertical's inline --app-primary-red,
 * a skin, the CDN theme); relative-colour syntax results and color-mix() results (only their inputs
 * are tested); CSS-modules class maps (styles.go); stylesheets injected from JS or loaded by <link>;
 * class names built at runtime; an undefined var() (ignored). A clean run means "none of these
 * patterns found", not "the page is right"; the browser check in light, dark and 375px still applies.
 *
 *   node scripts/check-ui-patterns.mjs                 report all routed pages, enforce allowlist + shared
 *   node scripts/check-ui-patterns.mjs --strict        enforce every page
 *   node scripts/check-ui-patterns.mjs --route /x      details for one route
 *   node scripts/check-ui-patterns.mjs --verbose       details for every page
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UI_ROOT = path.resolve(HERE, '..');
export const ALLOWLIST = path.join(HERE, 'ui-pattern-converted.txt');

/** Scanned once, as their own rule set, whatever the allowlist says (paths relative to the UI root). */
export const SHARED_FILES = [
  'src/styles/ping-ui.css',
  'src/components/privilege/PrivilegeLiveCheck.jsx',
  'src/components/privilege/PrivilegeLiveCheck.css',
];
/** Every .jsx/.js/.css file directly in these directories is shared too. */
export const SHARED_DIRS = ['src/components/pingUi'];
/** Global custom-property sources, used to resolve var() chains. */
const TOKEN_FILES = ['src/index.css'];
const TOKEN_DIRS = ['src/styles'];

// ---------- source helpers ----------

/** Remove JS/JSX comments (block and line) without touching `//` inside URLs or strings. */
export function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\\w])\/\/[^\n]*/g, (m, pre) => pre);
}

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Read one JSX tag starting at `i` (src[i] === '<'): returns { name, attrs, end, selfClosing }. */
function readTag(src, i) {
  const nm = /^<([A-Za-z][\w.]*)/.exec(src.slice(i, i + 80));
  if (!nm) return null;
  let j = i + nm[0].length;
  let depth = 0;
  let quote = null;
  for (; j < src.length; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === quote && src[j - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) break;
  }
  const attrs = src.slice(i + nm[0].length, j);
  const selfClosing = /\/\s*$/.test(attrs);
  return { name: nm[1], attrs, end: j + 1, selfClosing };
}

/** Inner source of a non-self-closing element that opened with `tag` (matching same-name nesting). */
function readInner(src, tag) {
  let depth = 1;
  const re = new RegExp(`<(/?)${tag.name.replace('.', '\\.')}(?=[\\s>/])`, 'g');
  re.lastIndex = tag.end;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) depth -= 1;
    else {
      const t = readTag(src, m.index);
      if (t && !t.selfClosing) depth += 1;
    }
    if (depth === 0) return src.slice(tag.end, m.index);
  }
  return src.slice(tag.end);
}

function eachTag(src, fn) {
  for (let i = src.indexOf('<'); i !== -1; i = src.indexOf('<', i + 1)) {
    const t = readTag(src, i);
    if (t) fn(t, i);
  }
}

/** Tokens of every className / buttonClassName attribute value in a tag's attrs. */
function classTokens(attrs) {
  const out = [];
  const re = /\b(?:className|buttonClassName)\s*=\s*/g;
  let m;
  while ((m = re.exec(attrs))) {
    let i = m.index + m[0].length;
    let val;
    if (attrs[i] === '"' || attrs[i] === "'") {
      const e = attrs.indexOf(attrs[i], i + 1);
      val = attrs.slice(i + 1, e === -1 ? undefined : e);
    } else if (attrs[i] === '{') {
      let d = 0;
      let k = i;
      for (; k < attrs.length; k += 1) {
        if (attrs[k] === '{') d += 1;
        else if (attrs[k] === '}') {
          d -= 1;
          if (d === 0) break;
        }
      }
      val = attrs.slice(i + 1, k);
    } else continue;
    out.push(...val.split(/[\s'"`{}$?:()&|,+]+/).filter(Boolean));
  }
  return out;
}

const BTN_NAME = /btn|button/i;

/**
 * Classes that the JSX puts on something that behaves as a button: a <button>, a *Button component,
 * role="button", <input type=button|submit|reset>, any element carrying a btn/button-named class
 * (an <a className="btn ...">), and PrivilegeLiveCheck's buttonClassName.
 */
export function buttonClasses(jsx) {
  const set = new Set();
  eachTag(jsx, (t) => {
    const tokens = classTokens(t.attrs);
    if (!tokens.length) return;
    const isButton =
      t.name === 'button' ||
      /Button$/.test(t.name) ||
      t.name === 'PrivilegeLiveCheck' ||
      /\brole\s*=\s*["']button["']/.test(t.attrs) ||
      (t.name === 'input' && /\btype\s*=\s*["'](button|submit|reset)["']/.test(t.attrs)) ||
      tokens.some((k) => BTN_NAME.test(k));
    if (isButton) tokens.forEach((k) => set.add(k));
  });
  return set;
}

// ---------- colour ----------

// CSS named colours, name:rrggbb.
const NAMED_HEX =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,' +
  'bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,' +
  'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
  'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,' +
  'darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,' +
  'darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,' +
  'dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,' +
  'green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,' +
  'indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,' +
  'lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,' +
  'lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,' +
  'maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,' +
  'mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
  'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
  'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,' +
  'orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
  'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,' +
  'powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,' +
  'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
  'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,' +
  'turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
  'yellowgreen:9acd32';
const NAMED = Object.fromEntries(
  NAMED_HEX.split(',').map((p) => {
    const [n, h] = p.split(':');
    return [n, [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16))];
  }),
);
// Named hues that are violet by name whatever the arithmetic says.
const VIOLET_NAMES = /\b(indigo|violet|purple|magenta|fuchsia|rebeccapurple|blueviolet|darkviolet|mediumpurple|slateblue)\b/gi;

function hexToRgb(h) {
  let x = h.replace('#', '');
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  if (x.length < 6) return null;
  return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
}

/** Violet / indigo / purple: hue 235-300 deg, HSL saturation > 20%, chroma >= 0.12. Ping blue #12538d is hue 209. */
export function isVioletIndigo(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return s > 0.2 && h >= 235 && h <= 300;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const encode = (c) => {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const toByte = (lin) => lin.map((c) => Math.round(encode(c) * 255));

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(clamp01(v) * 255));
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toByte([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

function labToRgb(L, a, b) {
  const eps = 216 / 24389;
  const kap = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const X = (fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kap) * (0.3457 / 0.3585);
  const Y = L > kap * eps ? fy ** 3 : L / kap;
  const Z = (fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kap) * ((1 - 0.3457 - 0.3585) / 0.3585);
  const x = 0.9554734527042182 * X - 0.023098536874261423 * Y + 0.0632593086610217 * Z;
  const y = -0.028369706963208136 * X + 1.0099954580058226 * Y + 0.021041398966943008 * Z;
  const z = 0.012314001688319899 * X - 0.020507696433477912 * Y + 1.3303659366080753 * Z;
  return toByte([
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
  ]);
}

const polar = (c, h) => [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

/** One component: number or percentage (100% = `full`), `none` = 0. */
function comp(tok, full = 1) {
  if (tok === undefined || tok === 'none') return 0;
  if (tok.endsWith('%')) return (parseFloat(tok) / 100) * full;
  const n = parseFloat(tok);
  return Number.isNaN(n) ? null : n;
}

function hueDeg(tok) {
  if (tok === undefined || tok === 'none') return 0;
  const n = parseFloat(tok);
  if (Number.isNaN(n)) return null;
  if (/turn$/.test(tok)) return n * 360;
  if (/grad$/.test(tok)) return n * 0.9;
  if (/rad$/.test(tok)) return (n * 180) / Math.PI;
  return n;
}

/** Parse one colour function (`hsl(250 80% 50%)`, `oklch(...)`, ...) to [r,g,b] 0-255, or null. */
export function colourFunctionToRgb(fn) {
  const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(fn.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const args = m[2].split('/')[0].trim().split(/[\s,]+/).filter(Boolean);
  if (args[0] === 'from') return null;
  const c = (i, full) => comp(args[i], full);
  let out = null;
  if (name === 'rgb' || name === 'rgba') {
    const v = [0, 1, 2].map((i) => (args[i]?.endsWith('%') ? comp(args[i], 255) : comp(args[i])));
    out = v.some((x) => x === null) ? null : v.map((x) => Math.round(Math.min(255, Math.max(0, x))));
  } else if (name === 'hsl' || name === 'hsla') {
    const h = hueDeg(args[0]);
    out = h === null ? null : hslToRgb(((h % 360) + 360) % 360, clamp01(parseFloat(args[1]) / 100), clamp01(parseFloat(args[2]) / 100));
  } else if (name === 'hwb') {
    const h = hueDeg(args[0]);
    if (h !== null) {
      const w = clamp01(parseFloat(args[1]) / 100);
      const b = clamp01(parseFloat(args[2]) / 100);
      if (w + b >= 1) {
        const g = Math.round((w / (w + b)) * 255);
        out = [g, g, g];
      } else {
        out = hslToRgb(((h % 360) + 360) % 360, 1, 0.5).map((v) => Math.round((v / 255) * (1 - w - b) * 255 + w * 255));
      }
    }
  } else if (name === 'oklab') {
    out = oklabToRgb(c(0, 1), c(1, 0.4), c(2, 0.4));
  } else if (name === 'oklch') {
    const h = hueDeg(args[2]);
    if (h !== null) out = oklabToRgb(c(0, 1), ...polar(c(1, 0.4), h));
  } else if (name === 'lab') {
    out = labToRgb(c(0, 100), c(1, 125), c(2, 125));
  } else if (name === 'lch') {
    const h = hueDeg(args[2]);
    if (h !== null) out = labToRgb(c(0, 100), ...polar(c(1, 150), h));
  } else if (name === 'color' && /^(srgb|display-p3)$/.test(args[0] || '')) {
    const v = [1, 2, 3].map((i) => comp(args[i], 1));
    out = v.some((x) => x === null) ? null : v.map((x) => Math.round(clamp01(x) * 255));
  }
  return out && out.every((x) => Number.isFinite(x)) ? out : null;
}

/** Index just after the `)` that closes the `(` at `open`, or -1. */
function closeParen(text, open) {
  let d = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') d += 1;
    else if (text[i] === ')') {
      d -= 1;
      if (d === 0) return i + 1;
    }
  }
  return -1;
}

/** Violet/indigo colour literals in an already var-free CSS value. */
export function violetLiterals(value) {
  const hits = [];
  const masked = value.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/g, ' ');
  for (const m of masked.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const rgb = hexToRgb(m[0]);
    if (rgb && isVioletIndigo(rgb)) hits.push(m[0]);
  }
  for (const m of masked.matchAll(/\b(rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\(/gi)) {
    const open = m.index + m[0].length - 1;
    const end = closeParen(masked, open);
    if (end === -1) continue;
    const text = masked.slice(m.index, end);
    const rgb = colourFunctionToRgb(text);
    if (rgb && isVioletIndigo(rgb)) hits.push(text);
  }
  for (const m of masked.matchAll(VIOLET_NAMES)) hits.push(m[0]);
  // Other named colours (navy, blue, plum...) by hue; custom-property names are not colours.
  const bare = masked.replace(/--[\w-]+/g, ' ').replace(/[a-z-]+\(/gi, '(');
  for (const m of bare.matchAll(/(?<![\w#-])[a-z]+(?![\w-])/gi)) {
    const rgb = NAMED[m[0].toLowerCase()];
    if (rgb && isVioletIndigo(rgb)) hits.push(m[0]);
  }
  return [...new Set(hits)];
}

/** Any colour literal at all (hex or colour function), for the inline-style rule. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch)\(/;

// ---------- CSS parsing ----------

/** Split on a separator at paren/bracket/quote depth 0. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const CONDITIONAL_AT = /^@(media|supports|layer|container|scope|document|starting-style)\b/;

/**
 * Flatten a stylesheet to [{ selector, decls: [[prop, value]] }], descending into @media/@supports/
 * @layer/@container and CSS nesting (`&` is replaced by the parent selector, otherwise it is prefixed).
 * Custom properties keep their case; other properties are lower-cased. `!important` is dropped.
 */
export function parseCss(css) {
  const src = stripCssComments(css);
  const rules = [];
  const walk = (text, sel) => {
    const decls = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    const pushDecl = (stmt) => {
      const s = stmt.trim();
      if (!s || s.startsWith('@')) return;
      const c = s.indexOf(':');
      if (c === -1) return;
      const prop = s.slice(0, c).trim();
      decls.push([prop.startsWith('--') ? prop : prop.toLowerCase(), s.slice(c + 1).replace(/\s*!important\s*$/i, '').trim()]);
    };
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth === 0) {
        pushDecl(text.slice(start, i));
        start = i + 1;
      } else if (ch === '{' && depth === 0) {
        let d = 1;
        let k = i + 1;
        for (; k < text.length && d > 0; k += 1) {
          if (text[k] === '{') d += 1;
          else if (text[k] === '}') d -= 1;
        }
        const prelude = text.slice(start, i).trim();
        const body = text.slice(i + 1, k - 1);
        if (CONDITIONAL_AT.test(prelude)) walk(body, sel);
        else if (!prelude.startsWith('@')) {
          const parts = splitTop(prelude.replace(/\s+/g, ' '), ',').map((p) => p.trim()).filter(Boolean);
          const nested = parts
            .map((p) => (sel ? (p.includes('&') ? p.replace(/&/g, sel.includes(',') ? `:is(${sel})` : sel) : `${sel} ${p}`) : p))
            .join(', ');
          walk(body, nested);
        }
        start = k;
        i = k - 1;
      }
    }
    pushDecl(text.slice(start));
    if (sel && decls.length) rules.push({ selector: sel, decls });
  };
  walk(src, null);
  return rules;
}

/** Add the custom-property definitions of a rule list to a Map name -> Set of values (every selector, theme and skin). */
function addTokens(map, rules) {
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) {
      if (!prop.startsWith('--')) continue;
      if (!map.has(prop)) map.set(prop, new Set());
      map.get(prop).add(value);
    }
  }
  return map;
}

const copyTokens = (tokens) => new Map([...tokens].map(([k, v]) => [k, new Set(v)]));

const VERTICAL_NAME = /^--(app-primary-red[\w-]*|theme-accent[\w-]*|brand-[\w-]+)$/;

/**
 * Expand every var() in `value` through all known definitions (and fallbacks). Returns
 * { values: string[], vertical: boolean } where vertical says a vertical colour token is in a chain.
 */
export function expandVars(value, tokens, trail = [], flags = { vertical: false }) {
  const at = value.indexOf('var(');
  if (at === -1) return { values: [value], vertical: flags.vertical };
  const end = closeParen(value, at + 3);
  if (end === -1) return { values: [value], vertical: flags.vertical };
  const parts = splitTop(value.slice(at + 4, end - 1), ',');
  const name = parts[0].trim();
  const fallback = parts.length > 1 ? parts.slice(1).join(',').trim() : null;
  if (VERTICAL_NAME.test(name)) flags.vertical = true;
  const cands = trail.includes(name) ? [] : [...(tokens.get(name) || [])];
  if (fallback !== null) cands.push(fallback);
  if (!cands.length) cands.push('');
  const out = [];
  for (const cand of cands) {
    for (const v of expandVars(cand, tokens, [...trail, name], flags).values.slice(0, 12)) {
      out.push(...expandVars(value.slice(0, at) + v + value.slice(end), tokens, trail, flags).values.slice(0, 12));
    }
  }
  return { values: [...new Set(out)].slice(0, 40), vertical: flags.vertical };
}

// ---------- font size ----------

const SIZE_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
const UNIT_PX = { px: 1, rem: 16, em: 16, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, '%': 0.16, ex: 8, ch: 8 };
const LENGTH = /^([+-]?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm|q|%|ex|ch)$/;

/** Evaluate + - * / and parentheses over plain numbers (the calc() subset), or null. */
function evalArith(expr) {
  const toks = expr.match(/\d*\.?\d+|[()+\-*/]/g);
  if (!toks || toks.join('') !== expr.replace(/\s+/g, '')) return null;
  let p = 0;
  const atom = () => {
    const t = toks[p++];
    if (t === '(') {
      const v = sum();
      p += 1;
      return v;
    }
    if (t === '-') return -atom();
    return Number(t);
  };
  const prod = () => {
    let v = atom();
    while (toks[p] === '*' || toks[p] === '/') v = toks[p++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const sum = () => {
    let v = prod();
    while (toks[p] === '+' || toks[p] === '-') v = toks[p++] === '+' ? v + prod() : v - prod();
    return v;
  };
  const v = sum();
  return p === toks.length && Number.isFinite(v) ? v : null;
}

/** Smallest px a CSS font size can take (clamp's floor, min's smallest), or null if it cannot be known. */
export function lengthToPx(raw) {
  const tok = raw.trim().toLowerCase();
  const m = LENGTH.exec(tok);
  if (m) return Number(m[1]) * UNIT_PX[m[2]];
  if (tok in SIZE_KEYWORDS) return SIZE_KEYWORDS[tok];
  const f = /^(calc|clamp|min|max)\(([\s\S]*)\)$/.exec(tok);
  if (!f) return null;
  if (f[1] === 'calc') {
    return evalArith(f[2].replace(/([+-]?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm|q|%|ex|ch)(?![a-z])/g, (_, n, u) => String(Number(n) * UNIT_PX[u])));
  }
  const args = splitTop(f[2], ',').map(lengthToPx);
  const known = args.filter((x) => x !== null);
  if (f[1] === 'clamp') return args[0];
  if (f[1] === 'min') return known.length ? Math.min(...known) : null;
  return known.length && (known.length === args.length || Math.max(...known) >= 10) ? Math.max(...known) : null;
}

const isSizeToken = (t) => LENGTH.test(t.toLowerCase()) || t.toLowerCase() in SIZE_KEYWORDS || /^(calc|clamp|min|max)\(/i.test(t);

/** The size token inside a `font` shorthand (`italic 700 9px/1.2 sans-serif` -> `9px`), or null. */
function fontShorthandSize(value) {
  for (const t of splitTop(value.trim(), ' ').filter(Boolean)) {
    const size = splitTop(t, '/')[0];
    if (isSizeToken(size)) return size;
  }
  return null;
}

/** Sizes below 10px declared by `font-size` or the `font` shorthand, after var() expansion. */
function smallFontSizes(prop, value, tokens) {
  if (prop !== 'font-size' && prop !== 'font') return [];
  const hits = [];
  for (const v of expandVars(value, tokens).values) {
    const tok = prop === 'font' ? fontShorthandSize(v) : v.trim();
    const px = tok ? lengthToPx(tok) : null;
    if (px !== null && px < 10) hits.push(tok);
  }
  return [...new Set(hits)];
}

// ---------- rules ----------

const ok = (rule, detail = '') => ({ rule, status: 'PASS', detail });
const drift = (rule, detail) => ({ rule, status: 'DRIFT', detail });
const info = (rule, detail) => ({ rule, status: 'INFO', detail });

const COLOUR_PROPS = /^(--[\w-]+|color|background|background-color|background-image|border(-(top|right|bottom|left|block|inline))?(-(start|end))?(-color)?|border-image|outline(-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(-color)?|accent-color|caret-color|-webkit-text-fill-color|-webkit-tap-highlight-color)$/;
const NAME_IS_BUTTON = /\bbutton\b|btn|[-_.]button|\[(type|role)\s*[~|^$*]?=\s*["']?(button|submit|reset)/i;

/** Does any selector in the list target a button (by element, name, or a class the JSX puts on one)? */
function targetsButton(selector, btnClasses) {
  return splitTop(selector, ',').some((part) => {
    if (NAME_IS_BUTTON.test(part)) return true;
    for (const m of part.matchAll(/\.((?:[\w-]|\\.)+)/g)) if (btnClasses.has(m[1].replace(/\\/g, ''))) return true;
    return false;
  });
}

function checkBanner(jsx) {
  const banner = /<SimBanner\b|role=["']note["']|className=["'][^"']*[\w-]*banner\b/.exec(jsx);
  if (!banner) return drift('P2 banner first', 'no simulation banner (SimBanner or role="note" .pu-banner) found');
  const before = jsx.slice(0, banner.index);
  const title = /<PageHeader\b|<h1\b/.exec(before);
  if (title) return drift('P2 banner first', `the title band (${title[0]}) comes before the banner`);
  const body = /<(section|Section|Card|table|button|main|form|PageFrame)\b|className=["'][^"']*\b[\w-]*(card|frame|panel)\b/.exec(before);
  if (body) return drift('P2 banner first', `${body[0].trim()} comes before the banner`);
  return ok('P2 banner first');
}

function checkPrimary(jsx) {
  let primaries = 0;
  let anyButton = false;
  eachTag(jsx, (t) => {
    if (t.name === 'button' || /Button$/.test(t.name)) anyButton = true;
    const tokens = classTokens(t.attrs);
    const classPrimary = tokens.some((k) => k === 'primary' || /(btn|button)[\w-]*primary$/i.test(k));
    const propPrimary = /Button$/.test(t.name) && /\bvariant\s*=\s*["']primary["']|\sprimary(?=[\s/=>]|$)/.test(` ${t.attrs}`);
    if (t.name === 'PrivilegeLiveCheck') {
      anyButton = true;
      // Its default trigger is "btn btn-primary": a page that does not override it has a hidden primary.
      if (!/\bbuttonClassName\s*=/.test(t.attrs)) primaries += 1;
      else if (classPrimary) primaries += 1;
      return;
    }
    if (classPrimary || propPrimary) primaries += 1;
  });
  if (primaries === 1) return ok('P9 one primary button');
  if (primaries > 1) return drift('P9 one primary button', `${primaries} primary buttons (exactly one per view)`);
  if (anyButton) return drift('P9 one primary button', 'has buttons but none is the primary');
  return info('P9 one primary button', 'no buttons on this page');
}

const BLANKS = /[\s​-‍⁠﻿]/g;
const NBSP_ENTITY = /&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj);|&#(?:160|8203|x[aA]0|x200[bB]);/g;
const BLANK_STRING = /^(["'`])(?:\s|\\u00a0|\\u200b|\\xa0|\\[nrt]|&nbsp;)*\1$/;

/** Is a JSX expression `{...}` blank: "", " ", null, undefined, false, [] or a + of blank strings? */
function blankExpression(expr) {
  const e = expr.trim();
  if (/^(null|undefined|false|true|void 0)?$/.test(e) || /^\[\s*\]$/.test(e)) return true;
  return e.split('+').every((p) => BLANK_STRING.test(p.trim()));
}

/** Does the inner source of a chip contain visible text? */
function hasVisibleText(inner) {
  let t = inner
    .replace(/<[A-Za-z][^>]*aria-hidden[^>]*\/>/g, '')
    .replace(/<([A-Za-z][\w.]*)[^>]*aria-hidden[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]*>/g, '');
  // Resolve {...} from the inside out: a blank expression vanishes, anything else counts as text.
  for (let guard = 0; guard < 20 && /\{[^{}]*\}/.test(t); guard += 1) {
    t = t.replace(/\{([^{}]*)\}/g, (_, e) => (blankExpression(e) ? '' : '\u0001'));
  }
  return t.replace(NBSP_ENTITY, '').replace(BLANKS, '').length > 0;
}

/** A chip can also carry its text as a children={...} / children="..." prop. */
function childrenPropHasText(attrs) {
  const m = /\bchildren\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})/.exec(attrs);
  if (!m) return false;
  if (m[3] !== undefined) return !blankExpression(m[3]);
  return (m[1] ?? m[2]).replace(NBSP_ENTITY, '').replace(BLANKS, '').length > 0;
}

function checkChips(jsx) {
  const bad = [];
  eachTag(jsx, (t, at) => {
    const tokens = classTokens(t.attrs);
    const chipClass = tokens.some((k) => !k.includes('__') && /(^|-)(chip|pill)(--[\w-]+)?$/.test(k));
    if (!(t.name === 'StatusChip' || chipClass)) return;
    const line = jsx.slice(0, at).split('\n').length;
    const text = childrenPropHasText(t.attrs) || (!t.selfClosing && hasVisibleText(readInner(jsx, t)));
    if (!text) bad.push(`line ${line}: <${t.name}> has no text`);
  });
  if (bad.length) return drift('P7 chips carry text', bad.slice(0, 3).join('; '));
  return ok('P7 chips carry text');
}

const THEMEABLE_STYLE = /(^|[{,\s])(color|background(Color|Image)?|border(Top|Right|Bottom|Left)?(Color)?|fontSize|fill|stroke|outline(Color)?|boxShadow|accentColor|caretColor)\s*:/;

function checkInlineColour(jsx) {
  const bad = [];
  eachTag(jsx, (t, at) => {
    const line = jsx.slice(0, at).split('\n').length;
    const sm = /\bstyle\s*=\s*\{\{([\s\S]*)\}\}/.exec(t.attrs);
    if (sm) {
      const hit = THEMEABLE_STYLE.exec(sm[1]);
      if (hit) bad.push(`line ${line}: inline style sets ${hit[2]}`);
      else if (COLOUR_LITERAL.test(sm[1])) bad.push(`line ${line}: colour literal in inline style`);
    }
    const attr = /\b(fill|stroke|color|stopColor|floodColor)\s*=\s*["'](#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch)\([^"']*\))["']/.exec(t.attrs);
    if (attr) bad.push(`line ${line}: ${attr[1]} attribute is a colour literal`);
  });
  for (const m of jsx.matchAll(/['"`]#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?['"`]/g)) {
    bad.push(`line ${jsx.slice(0, m.index).split('\n').length}: hex colour literal ${m[0]}`);
  }
  const uniq = [...new Set(bad)];
  if (uniq.length) return drift('H3 no inline colour', uniq.slice(0, 3).join('; '));
  return ok('H3 no inline colour');
}

/** Button colour (P9) and font floor (H2) over [{ file, css }], with custom properties from `tokens` plus the files'. */
function checkCss(cssFiles, tokens, btnClasses) {
  const violet = [];
  const small = [];
  const all = copyTokens(tokens);
  const parsed = cssFiles.map(({ file, css }) => ({ file, rules: parseCss(css) }));
  for (const { rules } of parsed) addTokens(all, rules);
  for (const { file, rules } of parsed) {
    for (const rule of rules) {
      const btn = targetsButton(rule.selector, btnClasses);
      for (const [prop, value] of rule.decls) {
        if (btn && COLOUR_PROPS.test(prop)) {
          const { values, vertical } = expandVars(value, all);
          const lit = [...new Set(values.flatMap(violetLiterals))];
          if (lit.length) violet.push(`${file} ${rule.selector} { ${prop}: ${lit[0]} }`);
          if (vertical) violet.push(`${file} ${rule.selector} { ${prop} reads a vertical colour token }`);
        }
        for (const s of smallFontSizes(prop, value, all)) small.push(`${file} ${rule.selector} { ${prop}: ${value} (${s}) }`);
      }
    }
  }
  return [
    violet.length
      ? drift('P9 no violet/indigo or vertical colour on buttons', [...new Set(violet)].slice(0, 3).join('; '))
      : ok('P9 no violet/indigo or vertical colour on buttons'),
    small.length ? drift('H2 10px font floor', [...new Set(small)].slice(0, 3).join('; ')) : ok('H2 10px font floor'),
  ];
}

/**
 * Check one page. `jsx` is its source; `css` is [{ file, css }] for the stylesheets it imports; `tokens`
 * is the global custom-property Map (loadGlobalTokens); `buttonClasses` adds classes known to sit on buttons.
 */
export function checkPage({ jsx, css = [], tokens = new Map(), buttonClasses: extra = [] }) {
  const src = stripJsComments(jsx);
  const btnClasses = new Set([...buttonClasses(src), ...extra]);
  return [checkBanner(src), checkPrimary(src), checkChips(src), checkInlineColour(src), ...checkCss(css, tokens, btnClasses)];
}

// ---------- files, imports, tokens ----------

const EXTS = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js'];
function resolveFile(base, rel) {
  const p = path.resolve(base, rel);
  for (const e of EXTS) {
    const f = p + e;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

/** Read a stylesheet and every stylesheet it pulls in with @import or `composes ... from` (transitively). */
export function readCssTree(file, root = UI_ROOT, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs) || !fs.existsSync(abs)) return [];
  seen.add(abs);
  const css = fs.readFileSync(abs, 'utf8');
  const out = [{ file: path.relative(root, abs), css }];
  const bare = stripCssComments(css);
  const refs = [
    ...[...bare.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?/gi)].map((m) => m[1]),
    ...[...bare.matchAll(/\bcomposes\s*:[^;{}]*?\bfrom\s+["']?([^"')\s;]+)["']?/gi)].map((m) => m[1]),
  ];
  for (const ref of refs) {
    if (/^(https?:|\/\/|data:|~|\/)/.test(ref) || !/\.css$/i.test(ref)) continue;
    out.push(...readCssTree(path.resolve(path.dirname(abs), ref), root, seen));
  }
  return out;
}

/** Stylesheets a JS/JSX file imports (side-effect or default import), with their @imports. */
function importedCss(file, jsx, root, seen = new Set()) {
  const out = [];
  for (const m of stripJsComments(jsx).matchAll(/import\s+(?:[\w*{}\s,]+\s+from\s+)?["'](\.[^"']+\.css)["']/g)) {
    out.push(...readCssTree(path.resolve(path.dirname(file), m[1]), root, seen));
  }
  return out;
}

/** Map route path -> page file, read from the <Route path element> entries of App.js. */
export function loadRoutes(root = UI_ROOT) {
  const appFile = path.join(root, 'src', 'App.js');
  const app = fs.readFileSync(appFile, 'utf8');
  const comps = {};
  for (const m of app.matchAll(/const\s+(\w+)\s*=\s*lazyWithRetry\(\s*\(\)\s*=>\s*import\(\s*["'](\.[^"']+)["']\s*\)\s*\)/g)) comps[m[1]] = m[2];
  for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+)["']/g)) comps[m[1]] = m[2];
  const routes = {};
  // element={<Wrapper><Page /></Wrapper>}: the page is the first component that is not a routes/ wrapper.
  for (const m of app.matchAll(/path=["'](\/[^"']*)["']\s*element=\{(?=((?:(?!<Route\b)[\s\S]){0,300}))/g)) {
    const names = [...m[2].matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]).filter((n) => comps[n]);
    const name = names.find((n) => !/\/routes\//.test(comps[n])) || names[0];
    const file = name && resolveFile(path.dirname(appFile), comps[name]);
    if (file) routes[m[1]] = file;
  }
  return routes;
}

export function loadAllowlist(file = ALLOWLIST) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/** Read a page file and the stylesheets it imports (following @import). */
export function readPage(file, root = UI_ROOT) {
  const jsx = fs.readFileSync(file, 'utf8');
  return { jsx, css: importedCss(file, jsx, root) };
}

const listDir = (root, dir, exts) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => exts.test(f))
    .sort()
    .map((f) => path.join(abs, f));
};

/** Custom properties from src/index.css and src/styles/*.css, for resolving var() chains. */
export function loadGlobalTokens(root = UI_ROOT) {
  const tokens = new Map();
  const files = [...TOKEN_FILES.map((f) => path.join(root, f)), ...TOKEN_DIRS.flatMap((d) => listDir(root, d, /\.css$/))];
  const seen = new Set();
  for (const f of files) for (const { css } of readCssTree(f, root, seen)) addTokens(tokens, parseCss(css));
  return tokens;
}

// ---------- the shared set ----------

const isScript = (f) => /\.jsx?$/.test(f.abs);

/** The shared files that exist, as [{ rel, abs }], plus the listed ones that do not. */
export function sharedFiles(root = UI_ROOT) {
  const present = [];
  const missing = [];
  for (const rel of SHARED_FILES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) present.push({ rel, abs });
    else missing.push(rel);
  }
  for (const dir of SHARED_DIRS) {
    const found = listDir(root, dir, /\.(jsx?|css)$/);
    if (!found.length) missing.push(`${dir}/ (no files)`);
    for (const abs of found) if (!present.some((p) => p.abs === abs)) present.push({ rel: path.relative(root, abs), abs });
  }
  return { present, missing };
}

/** Button classes the shared components put on a button (e.g. PrivilegeLiveCheck's plc__run). */
function sharedButtonClasses(files) {
  const set = new Set();
  for (const f of files.filter(isScript)) buttonClasses(stripJsComments(fs.readFileSync(f.abs, 'utf8'))).forEach((k) => set.add(k));
  return set;
}

/**
 * Check the shared stylesheet and components once. `extraButtonClasses` adds the classes that enforced
 * pages put on their buttons, so a shared rule such as `.pu-go` is judged as a button rule.
 */
export function checkShared({ root = UI_ROOT, tokens = new Map(), extraButtonClasses = [] } = {}) {
  const { present, missing } = sharedFiles(root);
  const results = missing.map((m) => drift('shared files present', `${m} is listed in SHARED_FILES/SHARED_DIRS but missing (renamed? update the script)`));
  const btn = new Set([...sharedButtonClasses(present), ...extraButtonClasses]);
  const seen = new Set();
  const css = [];
  for (const f of present.filter((p) => p.abs.endsWith('.css'))) css.push(...readCssTree(f.abs, root, seen));
  for (const f of present.filter(isScript)) css.push(...importedCss(f.abs, fs.readFileSync(f.abs, 'utf8'), root, seen));
  const jsx = present.filter(isScript).map((f) => ({ rel: f.rel, src: stripJsComments(fs.readFileSync(f.abs, 'utf8')) }));
  const perFile = (fn) => {
    const rs = jsx.map(({ rel, src }) => ({ rel, r: fn(src) }));
    const bad = rs.filter((x) => x.r.status === 'DRIFT');
    return bad.length ? drift(rs[0].r.rule, bad.map((x) => `${x.rel}: ${x.r.detail}`).join('; ')) : ok(rs[0].r.rule);
  };
  if (jsx.length) results.push(perFile(checkChips), perFile(checkInlineColour));
  results.push(...checkCss(css, tokens, btn));

  // The fixed button tokens stay Ping Red and the type scale keeps its 10px floor, wherever they are defined.
  const all = copyTokens(tokens);
  for (const { css: text } of css) addTokens(all, parseCss(text));
  const badBtn = [];
  const badScale = [];
  for (const [name, values] of all) {
    for (const v of values) {
      if (/^--btn-accent/.test(name) && expandVars(v, all).values.some((x) => violetLiterals(x).length)) badBtn.push(`${name}: ${v}`);
      if (/^--font-size-/.test(name) && smallFontSizes('font-size', v, all).length) badScale.push(`${name}: ${v}`);
    }
  }
  const tokenRule = (rule, bad) => (bad.length ? drift(rule, bad.slice(0, 3).join('; ')) : ok(rule));
  results.push(
    tokenRule('P9 fixed button tokens (--btn-accent*) are not violet/indigo', badBtn),
    tokenRule('H2 type scale (--font-size-*) stays at 10px or above', badScale),
  );
  const labelled = results.map((r) => ({ ...r, rule: `shared: ${r.rule}` }));
  return { files: present.map((p) => p.rel), results: labelled, failed: labelled.filter((r) => r.status === 'DRIFT') };
}

// ---------- running ----------

/** Relative component imports of a page that the shared set does not scan (the check cannot see inside them). */
function unscannedChildren(file, jsx, root, shared) {
  const out = [];
  for (const m of stripJsComments(jsx).matchAll(/import\s+[^'"]*?from\s+["'](\.[^"']+)["']/g)) {
    const f = resolveFile(path.dirname(file), m[1]);
    if (f && /\.jsx$/.test(f) && !shared.includes(path.relative(root, f))) out.push(path.relative(root, f));
  }
  return out;
}

/** Run every routed page and the shared set. Returns { pages, missing, shared }. */
export function runAll({ root = UI_ROOT, allowlist = loadAllowlist(path.join(root, 'scripts', 'ui-pattern-converted.txt')), strict = false } = {}) {
  const routes = loadRoutes(root);
  const tokens = loadGlobalTokens(root);
  const sharedPresent = sharedFiles(root).present;
  const sharedBtn = sharedButtonClasses(sharedPresent);
  const sharedRel = sharedPresent.map((p) => p.rel);
  const byFile = new Map();
  for (const [route, file] of Object.entries(routes)) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(route);
  }
  const missing = allowlist.filter((r) => !routes[r]);
  const enforcedBtn = new Set();
  const pages = [...byFile.entries()].map(([file, rs]) => {
    const page = readPage(file, root);
    const results = checkPage({ ...page, tokens, buttonClasses: [...sharedBtn] });
    const enforced = strict || rs.some((r) => allowlist.includes(r));
    if (enforced) buttonClasses(stripJsComments(page.jsx)).forEach((k) => enforcedBtn.add(k));
    const failed = results.filter((r) => r.status === 'DRIFT');
    const unscanned = enforced ? unscannedChildren(file, page.jsx, root, sharedRel) : [];
    return { routes: rs, file: path.relative(root, file), results, enforced, failed, unscanned };
  });
  const shared = checkShared({ root, tokens, extraButtonClasses: [...enforcedBtn] });
  return { pages, missing, shared };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const verbose = args.includes('--verbose');
  const routeArg = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
  const { pages, missing, shared } = runAll({ strict });
  let exit = 0;
  for (const m of missing) {
    console.error(`ALLOWLIST ${m}: no <Route> with this path in src/App.js (rename or remove it in scripts/ui-pattern-converted.txt)`);
    exit = 1;
  }
  console.log(`${shared.failed.length ? 'DRIFT' : 'PASS '}  [SHARED, always enforced] ${shared.files.join(', ')}`);
  for (const r of shared.results) if (verbose || routeArg || r.status === 'DRIFT') console.log(`    ${r.status.padEnd(5)} ${r.rule}${r.detail ? ` - ${r.detail}` : ''}`);
  if (shared.failed.length) exit = 1;
  let clean = 0;
  for (const p of pages) {
    if (routeArg && !p.routes.includes(routeArg)) continue;
    const tag = p.enforced ? 'ENFORCED' : 'advisory';
    if (!p.failed.length) clean += 1;
    const detail = p.enforced || verbose || routeArg;
    console.log(
      `${p.failed.length ? 'DRIFT' : 'PASS '}  [${tag}] ${p.routes.join(', ')}  (${p.file})` +
        (detail || !p.failed.length ? '' : `: ${p.failed.map((r) => r.rule).join(', ')}`),
    );
    if (detail) {
      for (const r of p.results) console.log(`    ${r.status.padEnd(5)} ${r.rule}${r.detail ? ` - ${r.detail}` : ''}`);
      if (p.unscanned.length) console.log(`    INFO  child components not scanned: ${p.unscanned.join(', ')}`);
    }
    if (p.enforced && p.failed.length) exit = 1;
  }
  const enforcedPages = pages.filter((p) => p.enforced);
  console.log(
    `${pages.length} routed pages: ${clean} clean, ${pages.length - clean} with drift; ` +
      `${enforcedPages.length} enforced (${enforcedPages.filter((p) => p.failed.length).length} failing); ` +
      `shared set ${shared.failed.length ? 'FAILING' : 'clean'}`,
  );
  if (exit) console.error('FAIL: an enforced page or the shared Ping UI set drifted from the Ping UI Standard (see DRIFT lines above).');
  process.exit(exit);
}

// Compare real paths: a symlinked cwd (macOS /var -> /private/var) must not turn the run into a silent no-op.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
