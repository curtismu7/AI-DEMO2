'use strict';

/**
 * Attack Simulator UCs (A6.1/A6.2) — every sim, real pipeline, live invariant
 * check (real).
 *
 * Zero automated coverage existed against the LIVE stack before this file —
 * only mocked unit tests (src/__tests__/attackSimulator*.test.js). That gap
 * hid a real bug: cross-owner-account's hardcoded FOREIGN_ACCOUNT_ID went
 * stale (the account it named stopped existing after a demo dataset reseed),
 * and the sim silently reported status:200/errorCode:'unexpected_permit' —
 * FALSELY claiming resource-ownership enforcement was broken, when the real
 * data-plane gate was (and always had been) correctly denying it. Fixed in
 * attackSimulatorService.js's _resolveForeignAccountId.
 *
 * This suite asserts the ONE invariant every attack sim must hold, live,
 * regardless of which specific denial code/status it reports: the attack
 * must never be reported as an unchallenged PERMIT, and the pipeline must
 * have genuinely run (tokenChainEvents non-empty). Exact status/errorCode
 * per sim is documented below from a live run (2026-07-27) for reference,
 * not asserted — several sims' internal error taxonomy (e.g. rar-exceeded /
 * impersonation-no-act reporting 502/invalid_scope rather than the 403
 * their own code comments describe) may be worth a follow-up audit, but
 * pinning those exact values here would make this suite as brittle as the
 * bug it exists to catch.
 *
 * Live-observed 2026-07-27 (ff_a2a_delegation / ff_hitl_enabled on):
 *   insufficient-scope     403 insufficient_scope
 *   wrong-aud               401 invalid_aud
 *   cross-owner-account     403 resource_owner_mismatch | mcp_authorization_denied (post-fix)
 *   replayed-token          401 invalid_aud
 *   rogue-actor             403 mcp_invalid_actor
 *   rar-exceeded            502 invalid_scope
 *   tampered-intent-token   401 invalid_signature
 *   impersonation-no-act    502 invalid_scope
 *   rate-limit-burst        403 gateway_policy_denied
 *   introspection-down      502 gateway_push_failed
 */

const { createBffClient } = require('../helpers/bffClient');

const VALID_SIMS = [
  'insufficient-scope',
  'wrong-aud',
  'cross-owner-account',
  'replayed-token',
  'rogue-actor',
  'rar-exceeded',
  'tampered-intent-token',
  'impersonation-no-act',
  'rate-limit-burst',
  'introspection-down',
];

const NEVER_ERROR_CODES = new Set(['unexpected_permit', 'unknown_sim', 'sim_execution_failed']);

describe('Attack Simulator UCs — every sim reports a real denial, not unexpected_permit (real)', () => {
  let client;
  let sessionOk = true;

  beforeAll(async () => {
    skipIfNoSession();
    try {
      client = createBffClient('enduser');
    } catch (_e) {
      sessionOk = false;
    }
  });

  for (const sim of VALID_SIMS) {
    it(`${sim}: reports a genuine denial, never unexpected_permit`, async () => {
      if (!sessionOk) {
        console.warn(`[attack-sim-live] no session — skipping ${sim}`);
        return;
      }

      const res = await client.post('/api/demo/attack-sim/run', { sim });

      // The route itself always answers 200 (or 403/production-guard) — the
      // ATTACK's outcome lives in the body, not the transport status.
      expect(res.status).toBe(200);

      const body = res.data;
      expect(body.sim).toBe(sim);
      expect(body.errorCode).toBeTruthy();
      expect(NEVER_ERROR_CODES.has(body.errorCode)).toBe(false);
      expect(Array.isArray(body.tokenChainEvents)).toBe(true);
      expect(body.tokenChainEvents.length).toBeGreaterThan(0);
      // A pass-through 200 with no denial code is the exact shape of the
      // cross-owner-account bug this suite exists to catch, regardless of
      // which sim produces it.
      if (body.status === 200) {
        expect(body.errorCode).not.toBe('unexpected_permit');
      }
    });
  }
});
