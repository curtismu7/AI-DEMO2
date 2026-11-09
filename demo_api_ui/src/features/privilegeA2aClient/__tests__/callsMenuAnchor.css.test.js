import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom has no layout, so this pins the cause; the effect was measured in a real browser at 375px
// (before: menu right edge 543px in a 371px viewport; after: inside the card).
const css = readFileSync(path.resolve(__dirname, '../PrivilegeA2aTab.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
const escape = (selector) => selector.replace(/[.[\]]/g, '\\$&');
// EVERY rule whose selector ends in `selector` (a later override is a rule too), in source order.
const bodies = (selector) => [...css.matchAll(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
// Every value the property is given across those rules; the cascade takes the last one (same specificity, later wins).
const values = (selector, prop) =>
  bodies(selector).flatMap((b) => [...b.matchAll(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1].replace(/!important/, '').trim()));
const last = (selector, prop) => values(selector, prop).at(-1);

const ACTIONS = '.a2a-page .privilege-a2a__actions';
const CALLS = '.a2a-page .privilege-a2a__calls';
const MENU = '.a2a-page .privilege-a2a__calls-menu';

describe('Calls menu stays inside the card', () => {
  test('is anchored to the actions row, not to the Calls button that sits mid-row once the row wraps', () => {
    expect(last(ACTIONS, 'position')).toBe('relative');
    expect(values(CALLS, 'position')).not.toContain('relative');
    expect(last(MENU, 'right')).toMatch(/^0(?:px)?$/);
    expect(values(MENU, 'left').filter((v) => /^0(?:px)?$/.test(v))).toEqual([]);
  });

  test('is never wider than the row it hangs from, and no viewport-width unit decides its size', () => {
    expect(last(MENU, 'width')).toMatch(/^min\(\d+px,\s*100%\)$/);
    expect(values(MENU, 'max-width').concat(values(MENU, 'min-width')).filter((v) => /\d+vw/.test(v))).toEqual([]);
    expect(css).not.toMatch(/calls-menu[^}]*\d+vw/);
  });
});
