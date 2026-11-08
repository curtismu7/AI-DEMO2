import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// The dark card ground measured in the browser (--th-bg-inset in dark) and the token cards tinted over it.
const DARK_GROUND = [27, 37, 64];
const over = (fg, a) => fg.map((v, i) => Math.round(v * a + DARK_GROUND[i] * (1 - a)));

describe('TokenChainTraceRail dark mode', () => {
  const css = read('components/TokenChainTraceRail.css');
  const darkColor = (selector) => {
    const m = css.match(new RegExp(`:root\\[data-theme="dark"\\] ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*?color:\\s*(#[0-9a-fA-F]{6})`));
    return m && m[1];
  };

  it.each([
    ['.tctr .tctr-inspect', DARK_GROUND],
    ['.tctr .tctr-inspect--emphasize', DARK_GROUND],
    ['.tctr .jh-key', DARK_GROUND],
    ['.tctr .jh-string', DARK_GROUND],
    ['.tctr .jh-number', DARK_GROUND],
    ['.tctr .jh-keyword', DARK_GROUND],
    ['.tctr .tctr-tok--user .tctr-tok-name', over([244, 114, 182], 0.12)],
    ['.tctr .tctr-tok--agent .tctr-tok-name', over([192, 132, 252], 0.12)],
    ['.tctr .tctr-tok--mcp .tctr-tok-name', over([52, 211, 153], 0.12)],
  ])('%s reads at 4.5:1 or better on the dark ground', (selector, ground) => {
    const color = darkColor(selector);
    expect(color, `no dark colour rule for ${selector}`).toBeTruthy();
    expect(ratio(hex(color), ground)).toBeGreaterThanOrEqual(4.5);
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
