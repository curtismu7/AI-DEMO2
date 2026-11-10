import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore - plain ESM script shared with the Claude Code PostToolUse hook
import { parseRules, loadTokens, resolveColors, contrast } from '../../scripts/check-contrast.mjs';

/**
 * Shared .table (index.css; used by Users, Accounts, Transactions, AdminCustomerPanel, ActivityLogs, Dashboard).
 * Measured in the running app with the PingOne end-user-nano skin loaded: the header was white on white in the
 * light theme (1.00:1) because a plain `.table th` loses to the skin, and the ground and ink were the same token
 * (--th-text) patched per theme. The header now reads two different surface tokens, with a selector that
 * beats the skin, in both themes.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');
const rules = parseRules(css);
const decl = (selector, prop) => rules.find((r) => r.selector === selector)?.decls.get(prop);

describe('shared .table header and cell contrast', () => {
  const tokens = loadTokens();

  for (const [what, selector] of [['header cell', ':root .table th'], ['body cell', ':root .table td'], ['hovered body cell', ':root .table tbody tr:hover td']]) {
    for (const theme of ['light', 'dark']) {
      it(`${what} is at least 4.5:1 in the ${theme} theme`, () => {
        const bgRaw = decl(selector, 'background-color');
        const fgRaw = decl(selector, 'color');
        expect(bgRaw, `${selector} sets a background`).toBeTruthy();
        expect(fgRaw, `${selector} sets its own colour`).toBeTruthy();
        const vars = tokens[theme];
        const bg = resolveColors(bgRaw, vars);
        const fg = resolveColors(fgRaw, vars);
        expect(bg && fg, 'both resolve to one colour').toBeTruthy();
        expect(contrast(fg[0], bg[0])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('does not use one token for the header ground and its ink', () => {
    expect(decl(':root .table th', 'background-color')).not.toBe(decl(':root .table th', 'color'));
  });

  it('has no per-theme header ink patch (dark ink on the dark theme)', () => {
    expect(css).not.toMatch(/:root\[data-theme="dark"\]\s+\.table th/);
    expect(css).not.toMatch(/:root:not\(\[data-theme="dark"\]\)\s+\.table th/);
  });

  it('paints no row with the text token as its ground', () => {
    const bad = rules.filter((r) => /(^|,|\s)\.table\b/.test(r.selector) && /var\(--th-text\)/.test(r.decls.get('background-color') ?? r.decls.get('background') ?? ''));
    expect(bad.map((r) => r.selector)).toEqual([]);
  });
});
