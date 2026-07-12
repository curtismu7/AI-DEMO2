'use strict';

/**
 * Phase 3: assembly-ordering contract for the NL router system prompt.
 *
 * Documented bug (geminiNlIntent.js buildSystemWithCtx comment): the role
 * note is appended AFTER the theme override, and "the LLM weighs later
 * instructions more heavily" — a role note carrying banking terminology
 * silently undid themes that instruct "never surface banking terminology".
 * The fix was vertical-NEUTRAL role wording. This suite locks that contract:
 * ordering (base -> theme -> role note last) and role-note neutrality.
 */

const path = require('node:path');
const { __test } = require('../../services/geminiNlIntent');

const { base: SYSTEM_BASE, themes: THEME_OVERRIDES } =
  require(path.join(__dirname, '../../../docs/HELIX_AGENT_DIRECTIVES.json'));

const ADMIN_NOTE = 'This user has admin privileges and can query data across all users.';
const USER_NOTE = 'This is a regular signed-in user — queries apply to their own data only.';

describe('prompt assembly ordering contract', () => {
  it('base rules come first, theme override after, for every themed vertical', () => {
    for (const [vertical, override] of Object.entries(THEME_OVERRIDES)) {
      if (!override) continue; // banking: no override text — SYSTEM_BASE alone covers it, per buildSystem's own truthiness check
      const sys = __test.buildSystem(vertical);
      expect(sys.startsWith(SYSTEM_BASE)).toBe(true);
      expect(sys.indexOf(override)).toBeGreaterThanOrEqual(SYSTEM_BASE.length);
    }
  });

  it('role note is appended LAST, after the theme content', () => {
    const vertical = Object.keys(THEME_OVERRIDES)[0];
    const sys = __test.buildSystemWithCtx(vertical, { role: 'admin', firstName: 'Ada' });
    const noteIdx = sys.indexOf(ADMIN_NOTE);
    expect(noteIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(sys.indexOf(THEME_OVERRIDES[vertical]));
    expect(sys.endsWith(ADMIN_NOTE)).toBe(true);
  });

  it('role notes are the locked vertical-neutral strings (the anti-override fix)', () => {
    const adminSys = __test.buildSystemWithCtx('healthcare', { role: 'admin' });
    const userSys = __test.buildSystemWithCtx('healthcare', { role: 'user' });
    expect(adminSys.endsWith(ADMIN_NOTE)).toBe(true);
    expect(userSys.endsWith(USER_NOTE)).toBe(true);
  });

  it('the appended role context never contains banking terminology (would override themes)', () => {
    for (const [vertical, override] of Object.entries(THEME_OVERRIDES)) {
      if (!override) continue; // banking: no override text — "after the theme" is undefined without one
      const sys = __test.buildSystemWithCtx(vertical, { role: 'admin', firstName: 'Ada' });
      const appended = sys.slice(__test.buildSystem(vertical).length);
      expect(appended).not.toMatch(/\b(bank|banking|account|accounts|transfer|balance)\b/i);
    }
  });

  it('no role in context leaves the system prompt untouched', () => {
    const vertical = Object.keys(THEME_OVERRIDES)[0];
    expect(__test.buildSystemWithCtx(vertical, {})).toBe(__test.buildSystem(vertical));
  });
});
