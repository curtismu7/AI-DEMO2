import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom has no :hover, so this pins the cause: ping-ui.css gives the primary a hover gradient and only excludes :disabled,
// so Send question (aria-disabled, never disabled) needs its own hover rule that keeps the resting look.
describe('Send question while aria-disabled', () => {
  const css = readFileSync(path.resolve(__dirname, '../PrivilegeA2aTab.css'), 'utf8');
  const rule = css.match(/\.a2a-page button\.pu-btn\.pu-btn--primary\[aria-disabled='true'\]:hover[^{]*\{[^}]*\}/)?.[0] ?? '';

  test('does not take the primary hover gradient', () => {
    expect(rule).not.toBe('');
    expect(rule).toContain('background-image: var(--btn-accent-gradient);');
    expect(rule).not.toContain('gradient-hover');
  });
});
