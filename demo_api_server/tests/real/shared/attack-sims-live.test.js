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
 * This suite asserts the invariants every attack sim must hold, live,
 * regardless of which specific denial code it reports: the attack must never
 * be reported as an unchallenged PERMIT, the pipeline must have genuinely run
 * (tokenChainEvents non-empty), and the denial must come from the SECURITY
 * tier, not the infrastructure tier — see DENIAL_STATUSES below.
 *
 * Why the tier check exists (added 2026-07-28): the 502s previously recorded
 * here as the expected taxonomy for rar-exceeded / impersonation-no-act were
 * never a taxonomy quirk — they were the sims failing at RFC 8693 token
 * exchange and never reaching the control they exist to prove. Root cause was
 * PingOne provisioning drift: fixing a scope-name collision by removing
 * read/write from the Token Exchanger's Demo MCP Server grant left ZERO
 * grantable source for those scopes, because the Demo MCP Gateway grant never
 * carried them either. Every sim requesting base read/write then died with
 * "At least one scope must be granted". Repaired by granting read/write on the
 * Gateway resource (the correct audience), which keeps the collision fixed.
 *
 * This suite stayed GREEN through that entire outage, because a 502 is not an
 * unexpected_permit. That is the hole DENIAL_STATUSES closes: a sim that dies
 * at the exchange/config layer tested nothing, and must fail loudly rather
 * than masquerade as a successful defense. Exact per-sim error CODES are still
 * not asserted — pinning those would make this suite as brittle as the bug it
 * exists to catch — but the tier is now a hard gate.
 *
 * Live-verified 2026-07-28 (ff_a2a_delegation / ff_hitl_enabled on), all ten
 * denying at the security tier with zero 5xx:
 *   insufficient-scope      403 insufficient_scope
 *   wrong-aud               401 invalid_aud
 *   cross-owner-account     403 mcp_authorization_denied
 *   replayed-token          401 invalid_aud
 *   rogue-actor             403 mcp_invalid_actor
 *   rar-exceeded            403 rar_amount_exceeded
 *   tampered-intent-token   401 invalid_signature
 *   impersonation-no-act    401 missing_act
 *   rate-limit-burst        403 gateway_policy_denied
 *   introspection-down      403 gateway_policy_denied
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

/**
 * A genuine security denial is always 401 (token/identity rejected) or 403
 * (policy denied). Anything else — 502 exchange_failed, 502 gateway_push_failed,
 * 503 gateway_not_configured — means the sim broke before reaching its control.
 * Asserted as a tier rather than a per-sim code list because the exchange
 * failures surface PingOne's own dynamic `pingoneError` values (invalid_scope,
 * invalid_grant, ...), which cannot be enumerated ahead of time.
 */
const DENIAL_STATUSES = [401, 403];

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

      // A 5xx here means the sim died at token exchange / gateway config and
      // never exercised its security control — a silent false PASS, since an
      // infrastructure failure is not an unexpected_permit. Compared as a
      // labelled string so the failure message carries the diagnostic detail
      // (PingOne's "At least one scope must be granted" lives in `reason`,
      // not in errorCode).
      const tier = DENIAL_STATUSES.includes(body.status)
        ? 'security'
        : `infrastructure (${body.status} ${body.errorCode}: ${body.reason})`;
      expect(tier).toBe('security');
      // A pass-through 200 with no denial code is the exact shape of the
      // cross-owner-account bug this suite exists to catch, regardless of
      // which sim produces it.
      if (body.status === 200) {
        expect(body.errorCode).not.toBe('unexpected_permit');
      }
    });
  }
});
