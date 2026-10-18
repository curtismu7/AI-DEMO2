#!/usr/bin/env node
/**
 * Static text/background contrast check for CSS ("no dark text on a dark background,
 * no light text on a light one").
 *
 * For every rule that sets BOTH `color` and a `background`/`background-color`, resolve both to
 * hex (literals, rgb(), white/black, var(--x[, fallback]) via the --th-* tokens in index.css in
 * both the light and dark theme) and require WCAG AA: 4.5:1 (3:1 for large text). Anything it
 * cannot resolve (color-mix, calc, unknown vars, alpha) is skipped, never guessed.
 *
 * Limits, stated plainly: it sees one rule at a time. It cannot see text that INHERITS its colour
 * into a container with a different background (the dark PageHeader band was the usual cause),
 * nor inline styles. Treat a clean run as "no same-rule mismatches", not "no contrast bugs".
 *
 * Ratchet: contrast-baseline.json holds the violations that existed when this was added. New ones
 * fail; fixing one only lowers the count (run with --update-baseline to record that).
 *
 *   node scripts/check-contrast.mjs                  all of src/, exit 1 on NEW violations
 *   node scripts/check-contrast.mjs --update-baseline
 *   node scripts/check-contrast.mjs --all            print every violation, baseline or not
 *   node scripts/check-contrast.mjs --hook           Claude Code PostToolUse hook (stdin JSON)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(here, '../src');
export const BASELINE = path.join(here, 'contrast-baseline.json');
// Vendor mocks and the clinical vertical keep their own look (see the brand-compliance skill).
const SKIP = ['aiFootprintMocks', 'agent-clinical', 'ChatgptLoginPage', 'FootprintMockGallery', 'ConsentMockPhoneFlow'];

const NAMED = { white: '#ffffff', black: '#000000' };

// ── CSS parsing ──────────────────────────────────────────────────────────────
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitDecls(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Flat list of { selector, decls: Map } — at-rule containers are flattened, keyframes skipped. */
export function parseRules(css) {
  const s = stripComments(css);
  const rules = [];
  const stack = []; // true = a skipped block, false = flattened container
  let i = 0;
  let prelude = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      const p = prelude.trim();
      if (p.startsWith('@')) {
        const skip = /^@(keyframes|-webkit-keyframes|font-face|property|page|counter-style)/.test(p);
        if (skip) {
          let depth = 1;
          i++;
          while (i < s.length && depth > 0) {
            if (s[i] === '{') depth++;
            if (s[i] === '}') depth--;
            i++;
          }
          prelude = '';
          continue;
        }
        stack.push(false);
        prelude = '';
        i++;
        continue;
      }
      const end = s.indexOf('}', i);
      if (end === -1) break;
      const decls = new Map();
      for (const d of splitDecls(s.slice(i + 1, end))) {
        const c = d.indexOf(':');
        if (c > 0) decls.set(d.slice(0, c).trim().toLowerCase(), d.slice(c + 1).replace(/!important/i, '').trim());
      }
      rules.push({ selector: p.replace(/\s+/g, ' '), decls });
      prelude = '';
      i = end + 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      prelude = '';
      i++;
      continue;
    }
    if (ch === ';') prelude = '';
    else prelude += ch;
    i++;
  }
  return rules;
}

// ── colour maths ─────────────────────────────────────────────────────────────
function hexToRgb(h) {
  let x = h.replace('#', '');
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  if (x.length === 8) x = x.slice(0, 6); // alpha ignored: judged against the opaque colour
  if (x.length !== 6) return null;
  const n = Number.parseInt(x, 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ── token resolution ─────────────────────────────────────────────────────────
function declaredVars(rules, test) {
  const m = new Map();
  for (const r of rules) {
    if (!test(r.selector)) continue;
    for (const [k, v] of r.decls) if (k.startsWith('--')) m.set(k, v);
  }
  return m;
}

export function loadTokens() {
  const rules = parseRules(fs.readFileSync(path.join(SRC, 'index.css'), 'utf8'));
  const light = declaredVars(rules, (s) => s === ':root');
  const dark = new Map([...light, ...declaredVars(rules, (s) => /^:root\[data-theme=["']dark["']\]$/.test(s))]);
  return { light, dark };
}

/** Resolve a CSS value to a list of opaque RGB colours, or null when not fully resolvable. */
function resolveColors(value, vars, depth = 0) {
  if (depth > 6 || !value) return null;
  const v = value.trim();
  const found = [];
  const re = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)|#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(white|black)\b|\b(transparent|currentcolor|inherit|none)\b|color-mix\(|calc\(|lch\(|hsl/g;
  let m;
  while ((m = re.exec(v))) {
    const t = m[0];
    if (t.startsWith('var(')) {
      const target = vars.get(m[1]);
      const sub = resolveColors(target ?? m[2], vars, depth + 1);
      if (!sub) return null;
      found.push(...sub);
    } else if (t.startsWith('#')) {
      const rgb = hexToRgb(t);
      if (!rgb) return null;
      found.push(rgb);
    } else if (t.startsWith('rgb')) {
      const parts = t.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.some(Number.isNaN)) return null;
      if (parts.length > 3 && parts[3] < 1) return null; // translucent: depends on what is behind it
      found.push(parts.slice(0, 3));
    } else if (m[3]) {
      found.push(hexToRgb(NAMED[m[3]]));
    } else return null; // transparent / currentcolor / color-mix / calc ...
  }
  return found.length ? found : null;
}

function fontPx(decls) {
  const f = decls.get('font-size');
  if (!f) return null;
  const px = /^([\d.]+)px$/.exec(f);
  if (px) return Number(px[1]);
  const rem = /^([\d.]+)rem$/.exec(f);
  return rem ? Number(rem[1]) * 16 : null;
}

// ── checking ─────────────────────────────────────────────────────────────────
export function checkCss(css, relPath, tokens) {
  const out = [];
  for (const { selector, decls } of parseRules(css)) {
    const fgRaw = decls.get('color');
    const bgRaw = decls.get('background-color') ?? decls.get('background');
    if (!fgRaw || !bgRaw) continue;
    const darkOnly = /\[data-theme=["']dark["']\]/.test(selector);
    const lightOnly = /\[data-theme=["']light["']\]/.test(selector);
    const local = new Map([...decls].filter(([k]) => k.startsWith('--')));
    for (const [theme, base] of [['light', tokens.light], ['dark', tokens.dark]]) {
      if ((darkOnly && theme === 'light') || (lightOnly && theme === 'dark')) continue;
      const vars = new Map([...base, ...local]);
      const fg = resolveColors(fgRaw, vars);
      const bg = resolveColors(bgRaw, vars);
      if (!fg || !bg || fg.length !== 1) continue;
      const px = fontPx(decls);
      const large = px !== null && (px >= 24 || (px >= 18.66 && /^(bold|[6-9]00)$/.test(decls.get('font-weight') ?? '')));
      const need = large ? 3 : 4.5;
      const worst = Math.min(...bg.map((b) => contrast(fg[0], b)));
      if (worst < need) {
        out.push({
          key: `${relPath}|${selector}|${theme}|${fgRaw}|${bgRaw}`,
          file: relPath,
          selector,
          theme,
          ratio: Math.round(worst * 100) / 100,
          need,
          fg: fgRaw,
          bg: bgRaw,
        });
      }
    }
  }
  return out;
}

export function listCss(dir = SRC) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...listCss(p));
    else if (e.name.endsWith('.css') && !SKIP.some((s) => p.includes(s))) files.push(p);
  }
  return files;
}

export function checkFiles(files, tokens = loadTokens()) {
  return files.flatMap((f) => checkCss(fs.readFileSync(f, 'utf8'), path.relative(SRC, f), tokens));
}

export function loadBaseline() {
  try {
    return new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
  } catch {
    return new Set();
  }
}

const fmt = (v) => `  ${v.file}  ${v.selector}  [${v.theme}] ${v.ratio}:1 < ${v.need}:1  color: ${v.fg}  background: ${v.bg}`;

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--hook')) {
    let payload = {};
    try {
      payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch {
      process.exit(0);
    }
    const file = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
    if (!file || !file.endsWith('.css') || !path.resolve(file).startsWith(SRC) || !fs.existsSync(file)) process.exit(0);
    if (SKIP.some((s) => file.includes(s))) process.exit(0);
    const base = loadBaseline();
    const fresh = checkFiles([file]).filter((v) => !base.has(v.key));
    if (fresh.length === 0) process.exit(0);
    process.stderr.write(
      `Contrast check failed in ${path.relative(SRC, file)} — text would be hard to read (WCAG AA 4.5:1, large text 3:1).\n` +
        `Dark text needs a light background and light text a dark one:\n${fresh.map(fmt).join('\n')}\n` +
        'Fix the colour pair (use --th-* tokens or the Ping palette), then re-save.\n',
    );
    process.exit(2);
  }

  const all = checkFiles(listCss());
  if (args.includes('--update-baseline')) {
    fs.writeFileSync(BASELINE, `${JSON.stringify([...new Set(all.map((v) => v.key))].sort(), null, 1)}\n`);
    console.log(`baseline: ${new Set(all.map((v) => v.key)).size} violations recorded`);
    return;
  }
  const base = loadBaseline();
  const fresh = all.filter((v) => !base.has(v.key));
  if (args.includes('--all')) console.log(all.map(fmt).join('\n'));
  console.log(`${all.length} contrast violations (${base.size} in baseline), ${fresh.length} new`);
  if (fresh.length) {
    console.error(fresh.map(fmt).join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
