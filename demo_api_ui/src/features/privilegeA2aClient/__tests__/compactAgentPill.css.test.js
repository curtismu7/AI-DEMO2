import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// jsdom has no layout, so the overlap itself is checked in a real browser; this pins the cause. The launcher used
// to be position: absolute at the column's bottom, which sat over the suggestion chips and the question box.
describe('Compact agent launcher', () => {
  const css = readFileSync(new URL('../PrivilegeA2aTab.css', import.meta.url), 'utf8');
  const rule = css.match(/\.cur-ide \.privilege-a2a__dock-open \{[^}]*\}/)?.[0] ?? '';

  test('takes its own row in the column, not an absolute position over its content', () => {
    expect(rule).toContain('position: static');
    expect(rule).not.toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/\bbottom:/);
  });
});
