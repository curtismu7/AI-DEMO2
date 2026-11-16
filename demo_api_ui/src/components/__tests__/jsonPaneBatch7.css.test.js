import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom applies no cascade, so these pin the stylesheet itself: a JSON pane is full view (no height cap, no inner
// scroll), and a rule written for a hand-rolled <pre> must not be left behind to restyle the shared pane (.jp-raw).
const read = (name) => readFileSync(path.resolve(__dirname, '..', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const CAP = /max-height|overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/;

// [stylesheet, selectors that wrap a JSON pane and must not cap or scroll it]
const WRAPPERS = [
  ['MFALogsModal.css', ['.logs-detail']],
  ['OASDemoPage.css', ['.oas-tryitout-result']],
  ['PingOneApiPanel.css', ['.p1-api-panel-body']],
];
// Selectors of the old hand-rolled <pre> rules, removed with the conversion.
const REMOVED = [
  ['InterAgentAbuseTester.css', '.iaa-details pre'],
  ['MFALogsModal.css', '.logs-detail pre'],
  ['MFALogsModal.css', '.logs-detail-json'],
  ['OASDemoPage.css', '.oas-raw-spec'],
];

describe('JSON pane batch 7 stylesheets', () => {
  test.each(WRAPPERS)('%s: the wrapper rule around the pane has no height cap or scroll', (file, selectors) => {
    const found = rules(read(file)).filter((r) => selectors.includes(r.selector));
    expect(found.length).toBe(selectors.length);
    for (const r of found) expect(r.body, r.selector).not.toMatch(CAP);
  });

  test.each(REMOVED)('%s no longer has the hand-rolled rule %s', (file, selector) => {
    // A rule can hide in a comma-grouped selector list, so test every single selector.
    const singles = rules(read(file)).flatMap((r) => r.selector.split(',').map((x) => x.trim()));
    expect(singles).not.toContain(selector);
  });

  test('MFALogsModal.css keeps no scrollbar rule for the removed .logs-detail-json or the now non-scrolling .logs-detail', () => {
    const singles = rules(read('MFALogsModal.css')).flatMap((r) => r.selector.split(',').map((x) => x.trim()));
    expect(singles.filter((x) => /^\.logs-detail(?:-json)?(?:$|::|:|\s)/.test(x) && /::-webkit-scrollbar|-json/.test(x))).toEqual([]);
  });

  test('InterAgentAbuseTester.css turns the pane alert ink to the success ink only inside a passed probe', () => {
    const found = rules(read('InterAgentAbuseTester.css')).filter((r) => r.selector.includes('.iaa-details--expected'));
    expect(found.length).toBe(1);
    expect(found[0].selector.split(',').map((x) => x.trim())).toEqual(['.iaa-details--expected .jp-box', '.iaa-details--expected .jp-wire']);
    expect(found[0].body).toMatch(/--jp-alert:\s*var\(--th-status-success-text\)/);
  });

  test('the Log Details field rules reach only the field label and value, not the pane inside it', () => {
    const selectors = rules(read('MFALogsModal.css')).map((r) => r.selector).filter((s) => s.startsWith('.logs-detail-field '));
    expect(selectors.length).toBeGreaterThan(1);
    for (const s of selectors) expect(s).toMatch(/^\.logs-detail-field > (?:label|span)$/);
  });
});
