import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeToken, hexRgb } from './helpers/themeTokens';

// Pins the shared JsonHighlight palette and the TokenChainTraceRail fixes with numbers measured from the real
// stylesheets and the real index.css tokens (a hex copied into a test stays green when the token changes).

const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const hex = (h) => hexRgb(h);

/** Declaration block of the rule whose selector list is exactly `selector`. */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}
const decl = (body, prop) => { const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`)); return m && m[1].trim(); };
const rgba = (value) => { const m = value.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/); return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] }; };
/** Resolve `#rrggbb` or `var(--th-x)` to rgb for a theme. */
const ink = (value, theme) => {
  const v = value.match(/^var\((--[\w-]+)\)$/);
  return hex(v ? themeToken(v[1], theme) : value);
};

const shared = read('components/shared/JsonHighlight.css');
const rail = read('components/TokenChainTraceRail.css');

describe('JsonHighlight .jh-focus meets WCAG AA on its own wash, in both themes', () => {
  const grounds = {
    light: { card: hex(themeToken('--th-bg-card', 'light')), inset: hex(themeToken('--th-bg-inset', 'light')) },
    dark: { card: hex(themeToken('--th-bg-card', 'dark')), inset: hex(themeToken('--th-bg-inset', 'dark')) },
  };

  it.each([['light', '.jh-focus'], ['dark', '.jh-dark .jh-focus']])('%s: %s clears 4.5:1 on the card and the inset', (theme, selector) => {
    const body = ruleBody(shared, selector);
    const wash = rgba(decl(body, 'background'));
    const color = ink(decl(body, 'color'), theme);
    Object.entries(grounds[theme]).forEach(([name, ground]) => {
      expect(ratio(color, over(wash.rgb, wash.a, ground)), `${selector} on ${name}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('the dark rail override uses the same ink as the shared palette', () => {
    const railFocus = decl(ruleBody(rail, ':root[data-theme="dark"] .tctr .jh-focus'), 'color');
    expect(railFocus).toBe(decl(ruleBody(shared, '.jh-dark .jh-focus'), 'color'));
  });

  it('the Token Security Tester page does not re-colour true / false / null red', () => {
    const tst = read('components/TokenSecurityTester.css');
    expect(tst).not.toMatch(/\.jh-keyword/);
  });
});

describe('JsonHighlight true / false / null are neutral, not bold red', () => {
  it.each([
    ['light', '.jh-keyword', 'light'],
    ['dark block', '.jh-dark .jh-keyword', 'dark'],
    ['rail dark', ':root[data-theme="dark"] .tctr .jh-keyword', 'dark'],
  ])('%s keeps a theme-token ink and regular weight', (_n, selector, theme) => {
    const body = ruleBody(selector.startsWith(':root') ? rail : shared, selector);
    const color = decl(body, 'color');
    expect(color).toMatch(/^var\(--th-[\w-]+\)$/);
    expect(decl(body, 'font-weight')).toBe('400');
    const [r, g, b] = ink(color, theme);
    expect(r - Math.max(g, b), 'not red').toBeLessThan(40);
  });

  it('keywords stay distinguishable from strings, numbers and keys', () => {
    const colours = ['.jh-key', '.jh-string', '.jh-number', '.jh-keyword'].map((s) => String(decl(ruleBody(shared, s), 'color')));
    expect(new Set(colours).size).toBe(4);
  });

  it('red stays reserved for critical fields (error, status, result...)', () => {
    expect(decl(ruleBody(shared, '.jh-critical'), 'color')).toBe('#d20e0f');
  });

  it('the pop-out document palette in TraceStepCard no longer paints keywords purple', () => {
    const src = readFileSync(resolve(__dirname, '..', 'components/TraceStepCard.jsx'), 'utf8');
    expect(src).not.toMatch(/\.jh-keyword\{color:#d2a8ff/);
    expect(src).toMatch(/\.jh-keyword\{color:#e5e7eb;font-weight:400\}/);
  });
});

describe('TokenChainTraceRail dark-theme text and icon contrast', () => {
  const card = hex(themeToken('--th-bg-card', 'dark'));
  const inset = hex(themeToken('--th-bg-inset', 'dark'));
  const darkInk = (selector) => ink(decl(ruleBody(rail, `:root[data-theme="dark"] ${selector}`), 'color'), 'dark');

  it.each([
    ['.tctr .tctr-ic--error', card],
    ['.tctr .tctr-ic--active', card],
    ['.tctr .tctr-ic--done', over([22, 163, 74], 0.12, card)],
  ])('step icon %s reads at 4.5:1 or better', (selector, ground) => {
    expect(ratio(darkInk(selector), ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('the evidence hint reads on the dark step body', () => {
    const body = rail.match(/:root\[data-theme="dark"\] \.tctr \.tctr-evidence-hint\s*\{([^}]*)\}/)[1];
    expect(ratio(ink(decl(body, 'color'), 'dark'), inset)).toBeGreaterThanOrEqual(4.5);
  });

  it('the More tray is a themed card, so its zoom / Legend / Clear controls are not white-on-white', () => {
    expect(decl(ruleBody(rail, '.tctr'), '--tctr-card-bg')).toBe('var(--th-bg-card)');
    expect(decl(ruleBody(rail, '.tctr-more-pop .tctr-zoom-btn,\n.tctr-more-pop .tctr-zoom-pct'), 'color')).toBe('var(--tctr-text)');
    expect(ratio(darkInk('.tctr .tctr-more-pop .tctr-clear-btn'), card)).toBeGreaterThanOrEqual(4.5);
  });

  it('the gateway stage rows take a themed ground with their own ink', () => {
    const body = ruleBody(rail, '.tctr-stage');
    expect(decl(body, 'background')).toBe('var(--th-bg-card)');
    expect(decl(body, 'color')).toBe('var(--th-text)');
  });
});

describe('TokenChainTraceRail light-theme text contrast', () => {
  const card = hex(themeToken('--th-bg-card', 'light'));
  it('pending and done step icons read on the light rows (pending was #fff on #fff)', () => {
    expect(ratio(ink(decl(ruleBody(rail, '.tctr-ic--pending'), 'color'), 'light'), card)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink(decl(ruleBody(rail, '.tctr-ic--done'), 'color'), 'light'), hex('#e8f7ee'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the evidence hint reads on the light step body', () => {
    const body = ruleBody(rail, '.tctr-evidence-hint');
    expect(ratio(ink(decl(body, 'color'), 'light'), hex(themeToken('--th-bg-inset', 'light')))).toBeGreaterThanOrEqual(4.5);
  });

  it('JSON in the step pre takes the light palette on the white card, every ink at 4.5:1 incl. the claim-diff washes', () => {
    const washes = [card, over([251, 191, 36], 0.24, card), over([45, 212, 191], 0.24, card)];
    ['jh-key', 'jh-string', 'jh-number', 'jh-keyword', 'jh-punct', 'jh-critical'].forEach((cls) => {
      const sel = cls === 'jh-punct'
        ? ':root:not([data-theme="dark"]) .tctr-code.jh-dark .jh-punct,\n:root:not([data-theme="dark"]) .tctr-code.jh-dark .jh-empty'
        : `:root:not([data-theme="dark"]) .tctr-code.jh-dark .${cls}`;
      const color = ink(decl(ruleBody(rail, sel), 'color'), 'light');
      washes.forEach((w) => expect(ratio(color, w), cls).toBeGreaterThanOrEqual(4.5));
    });
    const focus = ruleBody(rail, ':root:not([data-theme="dark"]) .tctr-code.jh-dark .jh-focus');
    const wash = rgba(decl(focus, 'background'));
    expect(ratio(ink(decl(focus, 'color'), 'light'), over(wash.rgb, wash.a, card))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('TokenChainTraceRail wraps instead of overflowing at phone width (371px)', () => {
  const nodeRail = read('components/TokenChainNodeRail.css');
  const reel = read('components/SequenceReelDiagram.css');

  it.each([
    ['rail header', rail, '.tctr-head'],
    ['rail toolbar', rail, '.tctr-toolbar'],
    ['rail chain tabs', rail, '.tctr-chain-tabs'],
    ['chain-map header (Run / speed / Present / Detailed-Compact)', nodeRail, '.tcnr-head'],
    ['sequence toolbar (font size, Reset)', reel, '.srd-toolbar'],
  ])('%s is a wrapping flex row', (_n, css, selector) => {
    expect(decl(ruleBody(css, selector), 'flex-wrap')).toBe('wrap');
  });

  it('the map/detail grid (340px second column) collapses to one column before phone width', () => {
    expect(rail).toMatch(/\.tctr-map-layout\s*\{[^}]*minmax\(340px,\s*1fr\)/);
    expect(rail).toMatch(/@media \(max-width: 920px\)\s*\{\s*\.tctr-map-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
