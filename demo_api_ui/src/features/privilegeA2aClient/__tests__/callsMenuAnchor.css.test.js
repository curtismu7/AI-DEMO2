import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// jsdom has no layout, so this pins the cause; the effect was measured in a real browser at 375px
// (before: menu right edge 543px in a 371px viewport; after: inside the card).
const css = readFileSync(path.resolve(__dirname, '../PrivilegeA2aTab.css'), 'utf8');
const rule = (selector) => {
  const m = css.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe('Calls menu stays inside the card', () => {
  test('is anchored to the actions row, not to the Calls button that sits mid-row once the row wraps', () => {
    expect(rule('.a2a-page .privilege-a2a__actions')).toMatch(/position:\s*relative/);
    expect(rule('.a2a-page .privilege-a2a__calls')).not.toMatch(/position:\s*relative/);
    const menu = rule('.a2a-page .privilege-a2a__calls-menu');
    expect(menu).toMatch(/right:\s*0/);
    expect(menu).not.toMatch(/\bleft:\s*0/);
  });

  test('is never wider than the row it hangs from, and no viewport-width unit decides its size', () => {
    const menu = rule('.a2a-page .privilege-a2a__calls-menu');
    expect(menu).toMatch(/width:\s*min\(\d+px,\s*100%\)/);
    expect(css).not.toMatch(/calls-menu[^}]*\d+vw/);
  });
});
