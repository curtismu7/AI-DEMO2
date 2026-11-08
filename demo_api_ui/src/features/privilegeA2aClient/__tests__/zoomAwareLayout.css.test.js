import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom has no layout, so this pins the causes; the effect was measured in a real browser (page height 144px over at 112.5%
// and 288px over at 125%, footer floating mid-page; 0 over after the fix).
const read = (rel) => readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('page zoom and full-height boxes', () => {
  // The page-zoom dial is CSS `zoom` on <html>; vh units ignore it, so a bare 100vh box is taller than the window by the zoom factor.
  test.each([
    ['index.css', '../../../index.css'],
    ['App.css', '../../../App.css'],
  ])('%s has no bare min-height: 100vh', (_name, rel) => {
    expect(read(rel)).not.toMatch(/min-height:\s*100vh\s*;/);
  });

  test('the zoom variable is set before first paint, not only after React mounts', () => {
    const html = readFileSync(path.resolve(__dirname, '../../../../index.html'), 'utf8');
    expect(html).toMatch(/setProperty\('--app-zoom'/);
  });
});

describe('A2A tab breakpoints', () => {
  const css = read('../PrivilegeA2aTab.css');

  test('are container queries on the tab, because @media widths ignore the page zoom', () => {
    expect(css).toMatch(/container:\s*pa2a\s*\/\s*inline-size/);
    expect(css).not.toMatch(/@media\s*\(max-width/);
    expect(css).toMatch(/@container pa2a \(max-width: \d+px\)/);
  });

  test('the narrower rule comes later, so it wins: two columns, then one, then the phone tweaks', () => {
    const widths = [...css.matchAll(/@container pa2a \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThanOrEqual(3);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });
});
