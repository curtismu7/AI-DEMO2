import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeToken, hexRgb } from './helpers/themeTokens';

// Three follow-ups to the shared inactive-primary change, measured from the real stylesheets and the real index.css
// tokens (a hex copied into a test stays green when the token changes):
//  1. no disabled / aria-disabled button is faded with opacity .88 (it stacked on the muted Ping Red fill, and the
//     two modal confirms had no muted fill at all), and the shared secondary toolbar button no longer fades its edge;
//  2. the TokenChainTraceRail More tray's active view-mode segment is visible against the tray in both themes.

const SRC = resolve(__dirname, '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const read = (rel) => strip(readFileSync(resolve(SRC, rel), 'utf8'));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const two = (n) => Math.round(n * 100) / 100;
const tok = (name, theme) => hexRgb(themeToken(name, theme));

/** Every top-level and @media-nested rule as { sel, body }. */
function rules(css) {
  const out = [];
  const walk = (text) => {
    const re = /([^{}]+)\{([^{}]*)\}|([^{}]+)\{/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1] !== undefined) out.push({ sel: m[1].trim(), body: m[2] });
    }
  };
  walk(css);
  return out;
}
const cssFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); }
    else if (name.endsWith('.css')) cssFiles.push(p);
  }
}(SRC));

describe('a disabled or aria-disabled button is never faded with opacity .88', () => {
  const offenders = [];
  for (const f of cssFiles) {
    for (const r of rules(strip(readFileSync(f, 'utf8')))) {
      if (!/:disabled|\[aria-disabled/.test(r.sel)) continue;
      if (/(^|[;\s])opacity\s*:\s*0?\.88\b/.test(r.body)) offenders.push(`${f.slice(SRC.length + 1)}: ${r.sel}`);
    }
  }
  it('no stylesheet rule on :disabled / [aria-disabled] sets opacity .88', () => {
    expect(offenders).toEqual([]);
  });

  it('the page-local primaries use the neutral-grey inactive tokens at full opacity (white label 5.40:1 and 6.59:1)', () => {
    const white = [255, 255, 255];
    const inactive = hexRgb(themeToken('--btn-accent-inactive', 'light'));
    const deep = hexRgb(/#636b74 55%,\s*(#[0-9a-f]{6})/i.exec(themeToken('--btn-accent-inactive-gradient', 'light'))[1]);
    expect(two(ratio(white, inactive))).toBe(5.4);
    expect(two(ratio(white, deep))).toBe(6.59);
    for (const [file, sel] of [
      ['pages/SecretRotationPage.css', 'button.srot-modal-btn.srot-modal-btn--confirm:disabled'],
      ['pages/DelegatedCommercePage.css', 'button.dcom-modal-btn.dcom-modal-btn--confirm[aria-disabled="true"]'],
      ['pages/PingOneProtectBrowserDemo.css', '.p1p-auth__run-chip[aria-disabled="true"]'],
    ]) {
      const rule = rules(read(file)).find((r) => r.sel === sel);
      expect(rule, `${file}: ${sel}`).toBeTruthy();
      expect(rule.body, sel).toMatch(/opacity:\s*1\b/);
      expect(rule.body, sel).toMatch(/background-color:\s*var\(--btn-accent-inactive\)/);
      expect(rule.body, sel).toMatch(/background-image:\s*var\(--btn-accent-inactive-gradient\)/);
      expect(rule.body, sel).toMatch(/color:\s*var\(--btn-accent-text\)/);
    }
  });
});

describe('the shared secondary toolbar button, disabled, keeps its edge and label legible', () => {
  const rule = rules(read('styles/ping-ui.css')).find((r) => r.sel === '.pu-page .dc-toolbar .dc-ctrl-btn:disabled');

  it('does not fade with opacity (0.75 took the edge to 2.64:1 on the page and 2.76:1 on the card in light)', () => {
    expect(rule).toBeTruthy();
    expect(rule.body).not.toMatch(/opacity/);
    expect(rule.body).toMatch(/border-style:\s*dashed/);
  });

  it.each([
    ['light', '--th-bg-page', 3.98], ['light', '--th-bg-card', 4.26],
    ['dark', '--th-bg-page', 11.14], ['dark', '--th-bg-card', 10.13],
  ])('%s: the --control-border edge on %s is %s:1 (3:1 needed)', (theme, ground, expected) => {
    const r = ratio(tok('--control-border', theme), tok(ground, theme));
    expect(two(r)).toBe(expected);
    expect(r).toBeGreaterThanOrEqual(3);
  });

  it.each([['light', 15.89], ['dark', 15.16]])('%s: the label on the inset ground is %s:1 (4.5:1 needed)', (theme, expected) => {
    const r = ratio(tok('--th-text-muted', theme), tok('--th-bg-inset', theme));
    expect(two(r)).toBe(expected);
    expect(r).toBeGreaterThanOrEqual(4.5);
  });
});

describe('TokenChainTraceRail More tray: the active view-mode segment is visible in both themes', () => {
  const css = read('components/TokenChainTraceRail.css');
  const active = rules(css).find((r) => r.sel === '.tctr-more-pop .tctr-view-mode button.active');
  const decl = (prop) => new RegExp(`(?:^|[;\\s])${prop}:\\s*var\\((--[\\w-]+)\\)`).exec(active.body)?.[1];

  it('takes its fill and ink from theme tokens, not the literal #051727', () => {
    expect(active).toBeTruthy();
    expect(active.body).not.toMatch(/#051727/i);
    expect(decl('background')).toBe('--th-bg-emphasis');
    expect(decl('color')).toBe('--th-text-on-emphasis');
  });

  it.each([
    // [theme, segment vs tray card, segment vs the pill (inset) it sits in, label on the segment]
    ['light', 12.77, 11.19, 12.77],
    ['dark', 9.44, 8.41, 10.05],
  ])('%s: segment %s:1 on the tray, %s:1 on the pill (3:1 needed); label %s:1 (4.5:1 needed)', (theme, onTray, onPill, label) => {
    const fill = tok(decl('background'), theme);
    const ink = tok(decl('color'), theme);
    const tray = tok('--th-bg-card', theme); // .tctr-more-pop paints var(--tctr-card-bg) = var(--th-bg-card)
    const pill = tok('--th-bg-inset', theme); // .tctr-more-pop .tctr-view-mode paints var(--tctr-pill-bg) = var(--th-bg-inset)
    expect(two(ratio(fill, tray))).toBe(onTray);
    expect(two(ratio(fill, pill))).toBe(onPill);
    expect(two(ratio(ink, fill))).toBe(label);
    expect(ratio(fill, tray)).toBeGreaterThanOrEqual(3);
    expect(ratio(fill, pill)).toBeGreaterThanOrEqual(3);
    expect(ratio(ink, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('the tray still paints the card and pill tokens measured above', () => {
    expect(/--tctr-card-bg:\s*var\(--th-bg-card\)/.test(css)).toBe(true);
    expect(/--tctr-pill-bg:\s*var\(--th-bg-inset\)/.test(css)).toBe(true);
  });

  it('the old literal measured 1.06:1 on the dark tray and 1.20:1 on the pill', () => {
    expect(two(ratio(hexRgb('#051727'), tok('--th-bg-card', 'dark')))).toBe(1.06);
    expect(two(ratio(hexRgb('#051727'), tok('--th-bg-inset', 'dark')))).toBe(1.2);
  });
});
