/**
 * C4 — auth gate for the feature-flags admin endpoint.
 *
 * Mutations require auth, full stop. There is no env escape hatch any more:
 * FF_ADMIN_REQUIRE_AUTH (opt-in hardening, unset = OPEN) was replaced by
 * FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS (opt-in anonymous, unset = SECURE) in
 * 9acedbddf, and that one is now gone too — neither was ever set anywhere, and
 * the flags it exposed (ff_hitl_enabled, step_up_enabled,
 * ff_skip_token_exchange, ff_inject_*, gateway policy modes) are the security
 * controls this internet-facing demo exists to prove.
 *
 * The last test is the point of this file: setting EITHER old variable must not
 * reopen the endpoint. A stale runbook, .env, or REGRESSION_PLAN line telling
 * someone to "restore the default" has to fail loudly instead of silently
 * working.
 */
const { makeFeatureFlagsAuthGate } = require('../middleware/featureFlagsAuthGate');

const DEAD_ENV_KEYS = ['FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS', 'FF_ADMIN_REQUIRE_AUTH'];

function run(gate, method) {
  const calls = { next: 0, auth: 0 };
  const auth = () => { calls.auth += 1; };
  const gateFn = gate(auth);
  gateFn({ method }, {}, () => { calls.next += 1; });
  return calls;
}

describe('featureFlagsAuthGate (C4)', () => {
  const prev = {};
  beforeEach(() => {
    for (const k of DEAD_ENV_KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of DEAD_ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  test('PATCH is routed through authenticateToken', () => {
    const c = run(makeFeatureFlagsAuthGate, 'PATCH');
    expect(c.auth).toBe(1);
    expect(c.next).toBe(0);
  });

  test.each(['POST', 'PUT', 'DELETE'])('%s also requires auth', (method) => {
    const c = run(makeFeatureFlagsAuthGate, method);
    expect(c.auth).toBe(1);
    expect(c.next).toBe(0);
  });

  test.each(['GET', 'HEAD'])('%s reads stay open so the pill can display state', (method) => {
    const c = run(makeFeatureFlagsAuthGate, method);
    expect(c.next).toBe(1);
    expect(c.auth).toBe(0);
  });

  test('neither retired env var can reopen mutations', () => {
    for (const key of DEAD_ENV_KEYS) {
      for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
        process.env[key] = value;
        const c = run(makeFeatureFlagsAuthGate, 'PATCH');
        expect(c.auth).toBe(1);
        expect(c.next).toBe(0);
      }
      delete process.env[key];
    }
  });
});
