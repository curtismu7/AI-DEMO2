/**
 * C4 — opt-in auth gate for the feature-flags admin endpoint.
 * Default OFF preserves the unauthenticated demo posture; FF_ADMIN_REQUIRE_AUTH
 * guards mutations only (reads stay open for the header pill).
 */
const { makeFeatureFlagsAuthGate } = require('../middleware/featureFlagsAuthGate');

function run(gate, method) {
  const calls = { next: 0, auth: 0 };
  const auth = () => { calls.auth += 1; };
  const gateFn = gate(auth);
  gateFn({ method }, {}, () => { calls.next += 1; });
  return calls;
}

describe('featureFlagsAuthGate (C4)', () => {
  const prev = process.env.FF_ADMIN_REQUIRE_AUTH;
  afterEach(() => {
    if (prev === undefined) delete process.env.FF_ADMIN_REQUIRE_AUTH;
    else process.env.FF_ADMIN_REQUIRE_AUTH = prev;
  });

  test('default (unset): PATCH passes through without auth — demo posture preserved', () => {
    delete process.env.FF_ADMIN_REQUIRE_AUTH;
    const c = run(makeFeatureFlagsAuthGate, 'PATCH');
    expect(c.next).toBe(1);
    expect(c.auth).toBe(0);
  });

  test('FF_ADMIN_REQUIRE_AUTH=true: PATCH is routed through authenticateToken', () => {
    process.env.FF_ADMIN_REQUIRE_AUTH = 'true';
    const c = run(makeFeatureFlagsAuthGate, 'PATCH');
    expect(c.auth).toBe(1);
    expect(c.next).toBe(0);
  });

  test('FF_ADMIN_REQUIRE_AUTH=true: GET reads stay open (pill can display state)', () => {
    process.env.FF_ADMIN_REQUIRE_AUTH = 'true';
    const c = run(makeFeatureFlagsAuthGate, 'GET');
    expect(c.next).toBe(1);
    expect(c.auth).toBe(0);
  });

  test('accepts common truthy spellings (1/yes/on), ignores others', () => {
    for (const v of ['1', 'yes', 'on', 'TRUE']) {
      process.env.FF_ADMIN_REQUIRE_AUTH = v;
      expect(run(makeFeatureFlagsAuthGate, 'PATCH').auth).toBe(1);
    }
    for (const v of ['0', 'false', 'off', '']) {
      process.env.FF_ADMIN_REQUIRE_AUTH = v;
      expect(run(makeFeatureFlagsAuthGate, 'PATCH').next).toBe(1);
    }
  });
});
