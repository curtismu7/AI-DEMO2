import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script shared with the Claude Code PostToolUse hook
import { checkFiles, listCss, loadBaseline, checkCss, loadTokens } from '../../scripts/check-contrast.mjs';

/**
 * Contrast ratchet: no NEW rule may pair text with a background it cannot be read on
 * (WCAG AA 4.5:1, large text 3:1) in either theme. Existing violations live in
 * scripts/contrast-baseline.json; fix one and re-run `node scripts/check-contrast.mjs --update-baseline`.
 * Same-rule pairs only: text inheriting its colour into a different background is not visible here.
 */
describe('contrast ratchet', () => {
  it('has no new unreadable text/background pairs', () => {
    const base = loadBaseline();
    const fresh = checkFiles(listCss()).filter((v) => !base.has(v.key));
    const msg = fresh.map((v) => `${v.file} ${v.selector} [${v.theme}] ${v.ratio}:1 color ${v.fg} on ${v.bg}`).join('\n');
    expect(fresh.length, `new contrast violations:\n${msg}`).toBe(0);
  });

  it('flags dark text on a dark background and light text on a light one', () => {
    const t = loadTokens();
    const bad = checkCss('.a { color: #051727; background: #263746; } .b { color: #fcfcfc; background: #ffffff; }', 'x.css', t);
    const ok = checkCss('.a { color: #ffffff; background: #051727; } .b { color: #051727; background: #fcfcfc; }', 'x.css', t);
    expect([...new Set(bad.map((v) => v.selector))].sort()).toEqual(['.a', '.b']);
    expect(ok).toEqual([]);
  });
});
