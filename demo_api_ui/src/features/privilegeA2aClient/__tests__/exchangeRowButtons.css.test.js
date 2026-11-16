import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom applies no cascade, so this pins the cause. Each exchange <li> holds the row's own button AND, below it, the
// pane with its Form | JSON toggle and Copy buttons. A descendant selector (`li button`) restyles those too.
const css = readFileSync(path.resolve(__dirname, '../PrivilegeA2aTab.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('exchange row styling reaches only the row button', () => {
  test('every exchange selector that targets a button uses the child combinator', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter((s) => s.includes('__exchange') && /\bbutton\b/.test(s));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector).toMatch(/li(?:\.is-[a-z]+)? > button/);
  });
});
