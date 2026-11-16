import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeToken, hexRgb } from './helpers/themeTokens';

// Measures every JsonPane role colour from the real stylesheets (JsonPane.css and the --th-* tokens of index.css),
// in both themes, on the grounds the pane uses: WCAG AA 4.5:1 for every ink, and the roles a reader must tell apart
// (number / true-false / null / string / key, and the three token segments) are visibly different colours.

const css = readFileSync(resolve(__dirname, '..', 'components/shared/JsonPane.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Custom properties declared in the rule whose selector list is exactly `selector`. */
function props(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}
const LIGHT = props('.jp-box,\n.jp-wire');
const DARK = props(':root[data-theme="dark"] .jp-box,\n:root[data-theme="dark"] .jp-wire');

function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** var() and color-mix(in srgb, A p%, B) over the theme's tokens, to [r, g, b]. */
function rgb(expr, theme) {
  const own = theme === 'dark' ? { ...LIGHT, ...DARK } : LIGHT;
  const v = expr.match(/^var\((--[\w-]+)\)$/);
  if (v) return v[1].startsWith('--jp-') ? rgb(own[v[1]], theme) : hexRgb(themeToken(v[1], theme));
  const mix = expr.match(/^color-mix\(in srgb,\s*([\s\S]+)\)$/);
  if (mix) {
    const [a, b] = splitTop(mix[1]);
    const pa = a.match(/^(.*)\s+(\d+(?:\.\d+)?)%$/);
    const w = Number(pa[2]) / 100;
    const ca = rgb(pa[1].trim(), theme);
    const cb = rgb(b, theme);
    return ca.map((x, i) => x * w + cb[i] * (1 - w));
  }
  return hexRgb(expr);
}

const INKS = ['key', 'string', 'number', 'bool', 'null', 'punct', 'url', 'id', 'time', 'alert', 'jwt1', 'jwt2', 'jwt3'];
const ink = (role, theme) => rgb(`var(--jp-${role})`, theme);

describe.each(['light', 'dark'])('JsonPane colours, %s theme', (theme) => {
  const code = hexRgb(themeToken('--th-code-bg', theme));
  const card = hexRgb(themeToken('--th-bg-card', theme));
  const hotBg = rgb('var(--jp-hot-bg)', theme);
  const codeInk = hexRgb(themeToken('--th-code-text', theme));

  it.each(INKS)('%s reads at 4.5:1 or better on the pane ground', (role) => {
    expect(ratio(ink(role, theme), code), `${role} on --th-code-bg`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['string', 'number', 'null', 'url', 'id', 'time', 'key'])('%s (a Form value or label) reads on the value box', (role) => {
    expect(ratio(ink(role, theme), card), `${role} on --th-bg-card`).toBeGreaterThanOrEqual(4.5);
  });

  it('important keys keep their ink readable on the tinted wash', () => {
    expect(ratio(codeInk, hotBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink('alert', theme), code)).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring of a focused pane (3px outline, --th-focus-ring) is 3:1 or better on the pane ground and on the card around it', () => {
    const ring = hexRgb(themeToken('--th-focus-ring', theme));
    expect(ratio(ring, code), 'ring on --th-code-bg').toBeGreaterThanOrEqual(3);
    expect(ratio(ring, card), 'ring on --th-bg-card').toBeGreaterThanOrEqual(3);
  });

  it('the Form chips read: true on its success wash, false on its warning wash', () => {
    const t = (n) => hexRgb(themeToken(n, theme));
    expect(ratio(t('--th-status-success-text'), t('--th-status-success-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t('--th-status-warning-text'), t('--th-status-warning-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('number, true/false, null, string and key are five different colours', () => {
    const roles = ['number', 'bool', 'null', 'string', 'key'];
    for (let i = 0; i < roles.length; i += 1) {
      for (let j = i + 1; j < roles.length; j += 1) {
        expect(dist(ink(roles[i], theme), ink(roles[j], theme)), `${roles[i]} vs ${roles[j]}`).toBeGreaterThanOrEqual(45);
      }
    }
  });

  it('the three token segments are three different colours', () => {
    const segs = ['jwt1', 'jwt2', 'jwt3'].map((r) => ink(r, theme));
    expect(dist(segs[0], segs[1])).toBeGreaterThanOrEqual(45);
    expect(dist(segs[1], segs[2])).toBeGreaterThanOrEqual(45);
    expect(dist(segs[0], segs[2])).toBeGreaterThanOrEqual(45);
  });
});
