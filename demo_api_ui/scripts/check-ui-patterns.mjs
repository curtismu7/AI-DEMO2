#!/usr/bin/env node
/**
 * Static check of a routed page against the Ping UI Standard (AI-DEMO-Standalone/shared/
 * STANDALONE-UI-PATTERNS.md, re-created for this app in docs/ping-ui-primitives.md). Mirrors
 * AI-DEMO-Standalone/scripts/check-ui-patterns.sh.
 *
 * Rules, per page (the page's JSX plus the stylesheets it imports directly):
 *   P2   the simulation banner comes first: before the title band and before any section/card/button
 *   P9   exactly one primary button per view (a PrivilegeLiveCheck without buttonClassName is one)
 *   P7   every status chip has text (never a bare dot)
 *   H3   no inline hex colours and no style={{ color/background/border/fontSize... }} on themeable props
 *   P9   no violet/indigo/purple literal, and no vertical colour token, on a button rule in CSS
 *   H2   no font-size below 10px in CSS
 *
 * Advisory by default: it reports every routed page and exits 0. It ENFORCES (exit 1) for the routes
 * listed in scripts/ui-pattern-converted.txt, and for a listed route that no longer resolves.
 * Convert a page, then add its route to that file in the same PR.
 *
 * It is a static, one-file heuristic, not a renderer: it cannot see a banner or button rendered by a
 * child component, nor a colour inherited at runtime. A clean run means "none of these patterns found",
 * not "the page is right"; the browser check in light, dark and 375px still applies.
 *
 *   node scripts/check-ui-patterns.mjs                 report all routed pages, enforce the allowlist
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

// ---------- colour helpers ----------

function hexToRgb(h) {
  let x = h.replace('#', '');
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  if (x.length < 6) return null;
  return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
}

/** Violet / indigo / purple: hue 235-300 deg with real saturation. Ping blue #12538d is hue 209. */
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
  return s >= 0.3 && h >= 235 && h <= 300;
}

/** Colour literals (hex, rgb(), named violet/indigo/purple) in a CSS value that are violet/indigo. */
export function violetLiterals(value) {
  const hits = [];
  for (const m of value.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const rgb = hexToRgb(m[0]);
    if (rgb && isVioletIndigo(rgb)) hits.push(m[0]);
  }
  for (const m of value.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    if (isVioletIndigo(rgb)) hits.push(m[0]);
  }
  for (const m of value.matchAll(/\b(indigo|violet|purple|magenta|fuchsia|rebeccapurple|blueviolet|darkviolet|mediumpurple|slateblue)\b/gi)) {
    hits.push(m[0]);
  }
  return hits;
}

// ---------- CSS parsing ----------

/** Flatten a stylesheet to [{ selector, decls: [[prop, value]] }], descending into @media/@supports/@layer. */
export function parseCss(css) {
  const src = stripCssComments(css);
  const rules = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      let d = 1;
      let k = open + 1;
      for (; k < text.length && d > 0; k += 1) {
        if (text[k] === '{') d += 1;
        else if (text[k] === '}') d -= 1;
      }
      const prelude = text.slice(i, open).trim();
      const body = text.slice(open + 1, k - 1);
      if (/^@(media|supports|layer|container)\b/.test(prelude)) walk(body);
      else if (!prelude.startsWith('@')) {
        const decls = body
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const c = s.indexOf(':');
            return c === -1 ? null : [s.slice(0, c).trim().toLowerCase(), s.slice(c + 1).trim()];
          })
          .filter(Boolean);
        rules.push({ selector: prelude.replace(/\s+/g, ' '), decls });
      }
      i = k;
    }
  };
  walk(src);
  return rules;
}

const isButtonSelector = (sel) => /\bbutton\b|btn|[-_.]button/i.test(sel);
const COLOUR_PROPS = /^(color|background(-color|-image)?|border(-top|-right|-bottom|-left)?(-color)?|outline(-color)?|fill|stroke|box-shadow|-webkit-text-fill-color)$/;
const VERTICAL_TOKEN = /var\(\s*--(app-primary-red[\w-]*|theme-accent[\w-]*|brand-[\w-]+)/;

// ---------- rules ----------

const ok = (rule, detail = '') => ({ rule, status: 'PASS', detail });
const drift = (rule, detail) => ({ rule, status: 'DRIFT', detail });
const info = (rule, detail) => ({ rule, status: 'INFO', detail });

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

function checkChips(jsx) {
  const bad = [];
  eachTag(jsx, (t, at) => {
    const tokens = classTokens(t.attrs);
    const chipClass = tokens.some((k) => !k.includes('__') && /(^|-)(chip|pill)(--[\w-]+)?$/.test(k));
    if (!(t.name === 'StatusChip' || chipClass)) return;
    const line = jsx.slice(0, at).split('\n').length;
    if (t.selfClosing) {
      bad.push(`line ${line}: <${t.name}> has no text`);
      return;
    }
    const inner = readInner(jsx, t);
    // Drop decorative parts (aria-hidden dots) and every remaining tag; what is left must be text.
    const text = inner
      .replace(/<[A-Za-z][^>]*aria-hidden[^>]*\/>/g, '')
      .replace(/<([A-Za-z][\w.]*)[^>]*aria-hidden[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\s*\}/g, '')
      .trim();
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
      else if (/#[0-9a-fA-F]{3,8}\b/.test(sm[1])) bad.push(`line ${line}: hex colour in inline style`);
    }
    const attr = /\b(fill|stroke|color|stopColor|floodColor)\s*=\s*["']#[0-9a-fA-F]{3,8}["']/.exec(t.attrs);
    if (attr) bad.push(`line ${line}: ${attr[1]} attribute is a hex literal`);
  });
  for (const m of jsx.matchAll(/['"`]#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?['"`]/g)) {
    bad.push(`line ${jsx.slice(0, m.index).split('\n').length}: hex colour literal ${m[0]}`);
  }
  const uniq = [...new Set(bad)];
  if (uniq.length) return drift('H3 no inline colour', uniq.slice(0, 3).join('; '));
  return ok('H3 no inline colour');
}

function checkCss(cssFiles) {
  const violet = [];
  const small = [];
  for (const { file, css } of cssFiles) {
    for (const rule of parseCss(css)) {
      const btn = isButtonSelector(rule.selector);
      for (const [prop, value] of rule.decls) {
        if (btn && COLOUR_PROPS.test(prop)) {
          const lit = violetLiterals(value);
          if (lit.length) violet.push(`${file} ${rule.selector} { ${prop}: ${lit[0]} }`);
          if (VERTICAL_TOKEN.test(value)) violet.push(`${file} ${rule.selector} { ${prop} reads a vertical colour token }`);
        }
        if (prop === 'font-size') {
          const px = /^(\d*\.?\d+)px$/.exec(value);
          const rem = /^(\d*\.?\d+)r?em$/.exec(value);
          if ((px && Number(px[1]) < 10) || (rem && Number(rem[1]) < 0.625)) {
            small.push(`${file} ${rule.selector} { font-size: ${value} }`);
          }
        }
      }
    }
  }
  return [
    violet.length
      ? drift('P9 no violet/indigo or vertical colour on buttons', violet.slice(0, 3).join('; '))
      : ok('P9 no violet/indigo or vertical colour on buttons'),
    small.length ? drift('H2 10px font floor', small.slice(0, 3).join('; ')) : ok('H2 10px font floor'),
  ];
}

/** Check one page. `jsx` is its source; `css` is [{ file, css }] for the stylesheets it imports. */
export function checkPage({ jsx, css = [] }) {
  const src = stripJsComments(jsx);
  return [checkBanner(src), checkPrimary(src), checkChips(src), checkInlineColour(src), ...checkCss(css)];
}

// ---------- routes and pages ----------

const EXTS = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js'];
function resolveFile(base, rel) {
  const p = path.resolve(base, rel);
  for (const e of EXTS) {
    const f = p + e;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
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

/** Read a page file and the stylesheets it imports directly. */
export function readPage(file) {
  const jsx = fs.readFileSync(file, 'utf8');
  const css = [];
  for (const m of stripJsComments(jsx).matchAll(/import\s+["'](\.[^"']+\.css)["']/g)) {
    const f = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(f)) css.push({ file: path.basename(f), css: fs.readFileSync(f, 'utf8') });
  }
  return { jsx, css };
}

/** Run every routed page. Returns { pages: [{ routes, file, results, enforced, failed }], missing }. */
export function runAll({ root = UI_ROOT, allowlist = loadAllowlist(), strict = false } = {}) {
  const routes = loadRoutes(root);
  const byFile = new Map();
  for (const [route, file] of Object.entries(routes)) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(route);
  }
  const missing = allowlist.filter((r) => !routes[r]);
  const pages = [...byFile.entries()].map(([file, rs]) => {
    const results = checkPage(readPage(file));
    const enforced = strict || rs.some((r) => allowlist.includes(r));
    const failed = results.filter((r) => r.status === 'DRIFT');
    return { routes: rs, file: path.relative(root, file), results, enforced, failed };
  });
  return { pages, missing };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const verbose = args.includes('--verbose');
  const routeArg = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
  const { pages, missing } = runAll({ strict });
  let exit = 0;
  for (const m of missing) {
    console.error(`ALLOWLIST ${m}: no <Route> with this path in src/App.js (rename or remove it in scripts/ui-pattern-converted.txt)`);
    exit = 1;
  }
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
    }
    if (p.enforced && p.failed.length) exit = 1;
  }
  const enforcedPages = pages.filter((p) => p.enforced);
  console.log(
    `${pages.length} routed pages: ${clean} clean, ${pages.length - clean} with drift; ` +
      `${enforcedPages.length} enforced (${enforcedPages.filter((p) => p.failed.length).length} failing)`,
  );
  if (exit) console.error('FAIL: an enforced page drifted from the Ping UI Standard (see DRIFT lines above).');
  process.exit(exit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
