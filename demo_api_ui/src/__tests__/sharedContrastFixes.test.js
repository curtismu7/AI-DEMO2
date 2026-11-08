import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeToken, hexRgb } from './helpers/themeTokens';

const css = (name) => readFileSync(resolve(__dirname, '..', 'components', name), 'utf8');
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// Every declaration block whose selector is exactly `selector`, joined (a selector can have several rules).
const rule = (source, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};

// Shared components that sit on every converted page; each was measured below 4.5:1 in a browser fixture of the real CSS.
describe('shared component contrast', () => {
  // The ground is the real light --th-bg-inset from index.css, not a hex copied into this file.
  const LIGHT_INSET = hexRgb(themeToken('--th-bg-inset', 'light'));

  it('node rail numbers clear 4.5:1 on the light inset ground (--th-bg-inset in index.css)', () => {
    const rail = css('TokenChainNodeRail.css');
    for (const [sel, expected] of [
      ['.tcnr-node--done .tcnr-node-n', '#166534'],
      ['.tcnr-node--active .tcnr-node-n', '#92400e'],
      ['.tcnr-node--denied .tcnr-node-n', '#aa0005'],
      ['.tcnr-node--error .tcnr-node-n', '#92400e'],
    ]) {
      const color = rule(rail, sel).match(/(?<![-\w])color:\s*(#[0-9a-fA-F]{6})/)?.[1];
      expect(color, sel).toBe(expected);
      expect(ratio(hex(color), LIGHT_INSET), sel).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the current step number is white on the info blue in both themes', () => {
    const reel = css('DiagramReel.css');
    const body = rule(reel, '.dreel-card--now .dreel-n');
    expect(body).toMatch(/color:\s*#ffffff/);
    expect(body).toMatch(/background:\s*var\(--th-status-info\)/);
    // The ground is the real --th-status-info in each theme (the same token in both today; read, not copied).
    for (const theme of ['light', 'dark']) {
      expect(ratio(hex('#ffffff'), hexRgb(themeToken('--th-status-info', theme))), theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('actor header initials use the text token and the dimmed state stays readable', () => {
    const sah = css('SequenceActorHeader.css');
    expect(rule(sah, '.sah__tile')).toMatch(/color:\s*var\(--th-text\)/);
    const dim = Number(rule(sah, '.sah__actor').match(/opacity:\s*([0-9.]+)/)?.[1]);
    expect(dim).toBeGreaterThanOrEqual(0.7);
  });
});

describe('DraggableModal at phone width', () => {
  it('caps width with a percentage so text zoom cannot push the panel past the viewport', () => {
    const modal = css('DraggableModal.css');
    expect(rule(modal, '.dm-panel')).toMatch(/max-width:\s*calc\(100% - 16px\)/);
    expect(modal).not.toMatch(/max-width:\s*calc\(100vw/);
  });
});
