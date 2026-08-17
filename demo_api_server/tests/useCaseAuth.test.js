'use strict';

/**
 * Use-case auth SoT (config/use-case-auth.json).
 *
 * Guards the bug this manifest exists to kill: the client gating a step behind
 * a sign-in prompt when the server answers it fine for a guest (UC24), and the
 * inverse — a step marked public that the server would refuse anyway.
 */

const { authLevelFor, isPublicUseCaseId, AUTH_LEVELS, DEFAULT_AUTH_LEVEL } = require('../config/useCaseAuth');
const MANIFEST = require('../config/use-case-auth.json');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases');
const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { PUBLIC_GUEST_ACTIONS } = require('../config/publicGuestActions');
const { parseHeuristic } = require('../services/nlIntentParser');

describe('use-case auth SoT', () => {
  it('covers every catalog entry and every admin demo step', () => {
    const ids = [...USE_CASES.map((u) => u.id), ...ADMIN_DEMO_STEPS.map((u) => u.id)];
    const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(MANIFEST.useCases, id));
    expect(missing).toEqual([]);
  });

  it('has no orphan entries', () => {
    const known = new Set([...USE_CASES.map((u) => u.id), ...ADMIN_DEMO_STEPS.map((u) => u.id)]);
    const orphans = Object.keys(MANIFEST.useCases).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it('only uses declared levels', () => {
    const bad = Object.entries(MANIFEST.useCases).filter(([, level]) => !AUTH_LEVELS.has(level));
    expect(bad).toEqual([]);
  });

  it('falls back to a signed-in level for an unknown id', () => {
    expect(authLevelFor('UC-DOES-NOT-EXIST')).toBe(DEFAULT_AUTH_LEVEL);
    expect(authLevelFor(undefined)).toBe(DEFAULT_AUTH_LEVEL);
    expect(isPublicUseCaseId('UC-DOES-NOT-EXIST')).toBe(false);
  });

  it('keeps UC24 public — the documented progressive-trust entry point', () => {
    expect(isPublicUseCaseId('UC24')).toBe(true);
  });

  it('keeps money-moving and admin steps behind a session', () => {
    expect(isPublicUseCaseId('UC1')).toBe(false);
    expect(isPublicUseCaseId('UC7')).toBe(false);
    expect(isPublicUseCaseId('UC8')).toBe(false);
    expect(authLevelFor('ADMIN1')).toBe('admin');
  });

  it('never marks a chip public that the server would refuse a guest, in any vertical', () => {
    const unenforceable = [];
    for (const uc of USE_CASES) {
      if (!isPublicUseCaseId(uc.id)) continue;
      for (const vertical of VERTICALS) {
        const trigger = resolveUseCase(uc.id, vertical)?.trigger || {};
        if (trigger.type !== 'chip' || !trigger.text) continue;
        const action = String(parseHeuristic(trigger.text)?.banking?.action || '');
        if (!PUBLIC_GUEST_ACTIONS.has(action)) {
          unenforceable.push(`${uc.id}/${vertical} → ${action || '<none>'}`);
        }
      }
    }
    expect(unenforceable).toEqual([]);
  });

  it('stamps auth onto every resolved catalog entry, derived from the base id', () => {
    for (const vertical of VERTICALS) {
      for (const uc of USE_CASES) {
        const resolved = resolveUseCase(uc.id, vertical);
        expect(resolved.auth).toBe(authLevelFor(uc.id));
      }
    }
  });
});
