import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeToken, hexRgb } from './helpers/themeTokens';

const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// The ground the rail is measured against is the real dark --th-bg-inset read from index.css (a hex copied
// here stayed green when the token changed), and each token card's tint is the real rgba() the rail's own
// stylesheet paints, composited over that ground.
const DARK_GROUND = hexRgb(themeToken('--th-bg-inset', 'dark'));
const over = (fg, a) => fg.map((v, i) => Math.round(v * a + DARK_GROUND[i] * (1 - a)));
const tintedGround = (railCss, cls) => {
  const esc = `:root\\[data-theme="dark"\\] \\.tctr \\.${cls}\\s*\\{[^}]*?background:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([0-9.]+)\\)`;
  const m = railCss.match(new RegExp(esc));
  if (!m) throw new Error(`no dark rgba() background for .${cls} in TokenChainTraceRail.css`);
  return over([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]));
};

describe('TokenChainTraceRail dark mode', () => {
  const css = read('components/TokenChainTraceRail.css');
  const darkColor = (selector) => {
    const m = css.match(new RegExp(`:root\\[data-theme="dark"\\] ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*?color:\\s*(#[0-9a-fA-F]{6})`));
    return m && m[1];
  };

  it.each([
    ['.tctr .tctr-inspect', () => DARK_GROUND],
    ['.tctr .tctr-inspect--emphasize', () => DARK_GROUND],
    ['.tctr .jh-key', () => DARK_GROUND],
    ['.tctr .jh-string', () => DARK_GROUND],
    ['.tctr .jh-number', () => DARK_GROUND],
    ['.tctr .jh-keyword', () => DARK_GROUND],
    ['.tctr .tctr-tok--user .tctr-tok-name', (c) => tintedGround(c, 'tctr-tok--user')],
    ['.tctr .tctr-tok--agent .tctr-tok-name', (c) => tintedGround(c, 'tctr-tok--agent')],
    ['.tctr .tctr-tok--mcp .tctr-tok-name', (c) => tintedGround(c, 'tctr-tok--mcp')],
  ])('%s reads at 4.5:1 or better on the dark ground', (selector, groundOf) => {
    const color = darkColor(selector);
    expect(color, `no dark colour rule for ${selector}`).toBeTruthy();
    expect(ratio(hex(color), groundOf(css))).toBeGreaterThanOrEqual(4.5);
  });

  it('measures the real token: the ground is the dark --th-bg-inset in index.css', () => {
    expect(themeToken('--th-bg-inset', 'dark')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DARK_GROUND).toEqual(hexRgb(themeToken('--th-bg-inset', 'dark')));
    expect(DARK_GROUND).not.toEqual(hexRgb(themeToken('--th-bg-inset', 'light')));
  });
});

describe('TopNav at phone width', () => {
  const css = read('components/TopNav.css');
  it('lets the wrapped right cluster keep its content width so search and Favorites stay on screen', () => {
    const blocks = css.split('@media (max-width: 1280px)').slice(1).map((b) => b.slice(0, 700));
    const rule = blocks.find((b) => /\.topnav-right-scroll\s*\{[^}]*min-width:\s*auto/.test(b));
    expect(rule, 'no narrow-viewport rule giving .topnav-right-scroll min-width: auto').toBeTruthy();
    expect(rule).toMatch(/\.topnav-right\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(rule).toMatch(/overflow-y:\s*visible/);
  });
});
