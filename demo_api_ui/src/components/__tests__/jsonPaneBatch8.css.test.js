import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom applies no cascade, so these pin the stylesheets themselves: a JSON pane is full view (no height cap, no inner
// scroll), and a rule written for a hand-rolled <pre> must not be left behind to restyle the shared pane (.jp-raw).
const read = (...parts) => readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const singles = (css) => rules(css).flatMap((r) => r.selector.split(',').map((x) => x.trim()));
const CAP = /max-height|overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/;

describe('JSON pane batch 8 stylesheets', () => {
  test('AuditAgentPage.css: the wrapper around the answer pane has no height cap or scroll and no ground of its own', () => {
    const found = rules(read('..', 'pages', 'AuditAgentPage.css')).filter((r) => r.selector === '.aap-answer');
    expect(found).toHaveLength(1);
    expect(found[0].body).not.toMatch(CAP);
    expect(found[0].body).not.toMatch(/background|color\s*:/);
  });

  test('ActivityLogPanel.css: the row-detail wrapper has no cap or scroll, and no rule styles a <pre> inside it', () => {
    const css = read('ActivityLogPanel.css');
    const found = rules(css).filter((r) => r.selector === '.alp-row-detail');
    expect(found).toHaveLength(1);
    expect(found[0].body).not.toMatch(CAP);
    expect(singles(css).filter((x) => /^\.alp-row-detail\s+\S/.test(x))).toEqual([]);
  });
});
