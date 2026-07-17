/**
 * C4 — auth gate for the feature-flags admin endpoint.
 *
 * Fail-secure: mutations require auth by DEFAULT. 9acedbddf ("resolve bugs
 * #41-#50 across auth, logging, retry, CORS, and agents") inverted this gate — it
 * used to be opt-IN auth via FF_ADMIN_REQUIRE_AUTH (unset = open), and is now
 * opt-IN *anonymous* via FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS (unset = require
 * auth). Reads (GET/HEAD) stay open in both modes so the header pill can always
 * display flag state.
 */
const { makeFeatureFlagsAuthGate } = require('../middleware/featureFlagsAuthGate');

const ENV_KEY = 'FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS';

function run(gate, method) {
  const calls = { next: 0, auth: 0 };
  const auth = () => { calls.auth += 1; };
  const gateFn = gate(auth);
  gateFn({ method }, {}, () => { calls.next += 1; });
  return calls;
}

describe('featureFlagsAuthGate (C4)', () => {
  const prev = process.env[ENV_KEY];
  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  test('default (unset): PATCH is routed through authenticateToken — fail-secure', () => {
    delete process.env[ENV_KEY];
    const c = run(makeFeatureFlagsAuthGate, 'PATCH');
    expect(c.auth).toBe(1);
    expect(c.next).toBe(0);
  });

  test('ALLOW_ANONYMOUS_MUTATIONS=true: PATCH passes through without auth', () => {
    process.env[ENV_KEY] = 'true';
    const c = run(makeFeatureFlagsAuthGate, 'PATCH');
    expect(c.next).toBe(1);
    expect(c.auth).toBe(0);
  });

  test('GET reads stay open while mutations require auth (pill can display state)', () => {
    delete process.env[ENV_KEY];
    const c = run(makeFeatureFlagsAuthGate, 'GET');
    expect(c.next).toBe(1);
    expect(c.auth).toBe(0);
  });

  test('accepts common truthy spellings (1/yes/on) to allow anonymous, ignores others', () => {
    for (const v of ['1', 'yes', 'on', 'TRUE']) {
      process.env[ENV_KEY] = v;
      expect(run(makeFeatureFlagsAuthGate, 'PATCH').next).toBe(1);
    }
    // Anything else — including empty — falls back to the fail-secure default.
    for (const v of ['0', 'false', 'off', '']) {
      process.env[ENV_KEY] = v;
      expect(run(makeFeatureFlagsAuthGate, 'PATCH').auth).toBe(1);
    }
  });
});
