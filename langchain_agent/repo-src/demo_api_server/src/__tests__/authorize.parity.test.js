/**
 * @file authorize.parity.test.js
 *
 * Parity contract test: simulated and PingOne engines must produce identical
 * enforcement flags { stepUpRequired, consentRequired } for the same inputs.
 *
 * Design requirement: the two engines are complete, drop-in replacements.
 * This test is the automated enforcement of that contract.
 *
 * NOTE on `decision` field:
 *   PingOne Authorize returns decision:'PERMIT' + obligations[] for step-up/consent.
 *   The simulated engine returns decision:'INDETERMINATE' for the same cases.
 *   This is a documented, intentional divergence in the raw decision string.
 *   The BFF gates (transactionAuthorizationService) act on the ENFORCEMENT FLAGS
 *   (stepUpRequired, consentRequired), NOT the raw decision string — so flag
 *   parity is what matters. DENY is tested separately (both engines agree).
 *
 * PingOne is exercised via a mocked global.fetch that returns the real PingOne
 * Authorize decision-endpoint v1 response shape, so _classifyRawObligations()
 * and classifyObligations() are exercised end-to-end, not stubbed.
 *
 * Thresholds (FIELD_DEFS defaults in configStore.js):
 *   confirm  (HITL_CONSENT): $250   (SIMULATED_AUTHORIZE_CONFIRM_AMOUNT)
 *   stepUp   (MFA):          $500   (SIMULATED_AUTHORIZE_STEPUP_AMOUNT)
 *   deny:                    $2000  (SIMULATED_AUTHORIZE_DENY_AMOUNT)
 *   consentTypes:            'transfer'  (SIMULATED_AUTHORIZE_CONSENT_TYPES)
 *   stepUpTypes:             ''          (SIMULATED_AUTHORIZE_STEPUP_TYPES)
 *
 * Policy rules (both engines implement these identically):
 *   amount > deny          → DENY (hard block)
 *   type in consentTypes   → HITL_CONSENT obligation (regardless of amount)
 *   amount >= confirmAmt   → HITL_CONSENT obligation
 *   amount >= stepUpAmt && !strongAcr → STEP_UP obligation
 *   STEP_UP > HITL_CONSENT (highest-gate-wins; if step-up fires, consentRequired=false)
 *   strongAcr bypasses STEP_UP but NOT consent
 */

// ── configStore mock — return null so thresholds fall through to env/defaults ─
jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn((key) => {
    if (key === 'ff_authorize_simulated') return 'true';
    return null;
  }),
  isReadOnly: jest.fn(() => true),
}));

const simulatedSvc = require('../../services/simulatedAuthorizeService');
const pingOneSvc   = require('../../services/pingOneAuthorizeService');

// ── PingOne response builders (v1 decision-endpoint shape) ────────────────────
function pingOnePermit() {
  return { id: `mock-${Date.now()}`, status: 'SUCCESS', decision: 'PERMIT', obligations: [], advice: [] };
}
function pingOneDeny() {
  return { id: `mock-${Date.now()}`, status: 'SUCCESS', decision: 'DENY', obligations: [], advice: [] };
}
function pingOneStepUp() {
  return {
    id: `mock-${Date.now()}`, status: 'SUCCESS', decision: 'PERMIT',
    obligations: [{ type: 'STEP_UP', detail: { acr: 'Multi_Factor' } }],
    advice: [],
  };
}
function pingOneConsent() {
  return {
    id: `mock-${Date.now()}`, status: 'SUCCESS', decision: 'PERMIT',
    obligations: [{ type: 'HITL_CONSENT', detail: 'Human approval required.' }],
    advice: [],
  };
}

// ── Parity test matrix ────────────────────────────────────────────────────────
// Each entry asserts that simulated and PingOne produce the same enforcement
// flags for identical inputs. `mockPingOne` encodes what the real PingOne
// Authorize policy would return for that scenario.

const PARITY_CASES = [
  {
    label: 'small deposit below all thresholds → no gates (PERMIT)',
    input:       { userId: 'u1', amount: 50,    type: 'deposit',    acr: '' },
    // deposit not in consentTypes; amount < $250 confirm; amount < $500 step-up
    expectFlags: { stepUpRequired: false, consentRequired: false },
    mockPingOne: pingOnePermit,
  },
  {
    label: 'transfer below confirm threshold → consent (transfer type always triggers consent)',
    input:       { userId: 'u1', amount: 100,   type: 'transfer',   acr: '' },
    // 'transfer' is in default consentTypes → typeRequiresConsent=true → HITL_CONSENT
    expectFlags: { stepUpRequired: false, consentRequired: true },
    mockPingOne: pingOneConsent,
  },
  {
    label: 'transfer at confirm threshold → consent',
    input:       { userId: 'u1', amount: 250,   type: 'transfer',   acr: '' },
    // typeRequiresConsent=true, amountRequiresConsent(>=250)=true; amount<500 no step-up
    expectFlags: { stepUpRequired: false, consentRequired: true },
    mockPingOne: pingOneConsent,
  },
  {
    label: 'transfer between confirm and step-up → consent (no MFA)',
    input:       { userId: 'u1', amount: 400,   type: 'transfer',   acr: '' },
    // typeRequiresConsent=true; amount<500 so step-up not triggered
    expectFlags: { stepUpRequired: false, consentRequired: true },
    mockPingOne: pingOneConsent,
  },
  {
    label: 'withdrawal at step-up threshold → step-up (withdrawal not in consentTypes)',
    input:       { userId: 'u1', amount: 500,   type: 'withdrawal', acr: '' },
    // amount>=500 → step-up; withdrawal not in consentTypes; step-up wins
    expectFlags: { stepUpRequired: true,  consentRequired: false },
    mockPingOne: pingOneStepUp,
  },
  {
    label: 'transfer at step-up threshold → step-up wins over consent (highest-gate-wins)',
    input:       { userId: 'u1', amount: 500,   type: 'transfer',   acr: '' },
    // typeRequiresConsent=true AND amountRequiresStepUp=true; STEP_UP dominates
    expectFlags: { stepUpRequired: true,  consentRequired: false },
    mockPingOne: pingOneStepUp,
  },
  {
    label: 'strong ACR bypasses step-up — withdrawal above step-up threshold',
    input:       { userId: 'u1', amount: 600,   type: 'withdrawal', acr: 'Multi_Factor' },
    // acrLooksStrong('Multi_Factor')=true → amountRequiresStepUp=false
    // withdrawal not in consentTypes; amountRequiresConsent(600>=250)=true → consent
    expectFlags: { stepUpRequired: false, consentRequired: true },
    mockPingOne: pingOneConsent,
  },
  {
    label: 'strong ACR with transfer → consent survives (strong ACR only bypasses step-up)',
    input:       { userId: 'u1', amount: 300,   type: 'transfer',   acr: 'Multi_Factor' },
    // acrLooksStrong=true → step-up bypassed; transfer in consentTypes → consent still fires
    expectFlags: { stepUpRequired: false, consentRequired: true },
    mockPingOne: pingOneConsent,
  },
  {
    label: 'withdrawal exactly at deny threshold → step-up (deny is >, not >=)',
    input:       { userId: 'u1', amount: 2000,  type: 'withdrawal', acr: '' },
    // amount > 2000 = false so not denied; amount >= 500 = true → step-up
    expectFlags: { stepUpRequired: true,  consentRequired: false },
    mockPingOne: pingOneStepUp,
  },
];

// ── PingOne credentials (injected via process.env for each test) ──────────────
const MOCK_ENV = {
  PINGONE_ENVIRONMENT_ID:                 'mock-env-id',
  PINGONE_REGION:                         'com',
  PINGONE_AUTHORIZE_WORKER_CLIENT_ID:     'mock-worker-client',
  PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET: 'mock-worker-secret',
  PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID: 'mock-endpoint-id',
};

// ── Enforcement-flag parity suite ────────────────────────────────────────────
describe('Authorize parity: enforcement flags match between simulated and PingOne', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv   = process.env;
    process.env   = { ...originalEnv, ...MOCK_ENV };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env  = originalEnv;
  });

  for (const tc of PARITY_CASES) {
    // eslint-disable-next-line no-loop-func
    it(tc.label, async () => {
      // ── Simulated engine ──────────────────────────────────────────────────
      const simResult = await simulatedSvc.evaluateTransaction(tc.input);
      const simFlags = { stepUpRequired: simResult.stepUpRequired, consentRequired: simResult.consentRequired };
      expect({ source: 'simulated', ...simFlags }).toEqual({ source: 'simulated', ...tc.expectFlags });

      // ── PingOne engine (mocked fetch) ─────────────────────────────────────
      // Call 1: worker token.  Call 2: decision endpoint evaluation.
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock-worker-token', expires_in: 300 }),
          text: async () => '{}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => tc.mockPingOne(),
          text: async () => '{}',
        });

      const pingResult = await pingOneSvc.evaluateTransaction(tc.input);
      const pingFlags = { stepUpRequired: pingResult.stepUpRequired, consentRequired: pingResult.consentRequired };
      expect({ source: 'pingone', ...pingFlags }).toEqual({ source: 'pingone', ...tc.expectFlags });

      // ── Cross-engine equivalence ──────────────────────────────────────────
      expect(simFlags).toEqual(pingFlags);
    });
  }
});

// ── DENY parity — both engines must agree on DENY decision ───────────────────
describe('Authorize parity: DENY decision matches between engines', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv   = process.env;
    process.env   = { ...originalEnv, ...MOCK_ENV };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env  = originalEnv;
  });

  it('amount above deny threshold → both engines return DENY', async () => {
    const input = { userId: 'u1', amount: 2001, type: 'transfer', acr: '' };

    const simResult = await simulatedSvc.evaluateTransaction(input);
    expect(simResult.decision).toBe('DENY');
    expect(simResult.stepUpRequired).toBe(false);
    expect(simResult.consentRequired).toBe(false);

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 300 }), text: async () => '{}' })
      .mockResolvedValueOnce({ ok: true, json: async () => pingOneDeny(), text: async () => '{}' });

    const pingResult = await pingOneSvc.evaluateTransaction(input);
    expect(pingResult.decision).toBe('DENY');
    expect(pingResult.stepUpRequired).toBe(false);
    expect(pingResult.consentRequired).toBe(false);
  });
});

// ── Wire-contract field presence (F7) ────────────────────────────────────────
// Both engine results must always have consentRequired as a boolean (not undefined).
// This locks the F7 fix: callers can rely on consentRequired regardless of engine.
describe('Authorize parity: consentRequired always defined as boolean', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv   = process.env;
    process.env   = { ...originalEnv, ...MOCK_ENV };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env  = originalEnv;
  });

  it('simulated: consentRequired and stepUpRequired are always booleans', async () => {
    const r = await simulatedSvc.evaluateTransaction({ userId: 'u1', amount: 300, type: 'transfer', acr: '' });
    expect(typeof r.consentRequired).toBe('boolean');
    expect(typeof r.stepUpRequired).toBe('boolean');
    expect(r.consentRequired).toBe(true); // transfer type triggers consent
  });

  it('PingOne: consentRequired=true for HITL_CONSENT obligation (not hitlRequired)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 300 }), text: async () => '{}' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', status: 'SUCCESS', decision: 'PERMIT', obligations: [{ type: 'HITL_CONSENT' }], advice: [] }),
        text: async () => '{}',
      });

    const r = await pingOneSvc.evaluateTransaction({ userId: 'u1', amount: 300, type: 'transfer', acr: '' });
    // HITL_CONSENT → consentRequired:true; hitlRequired:false (most-specific-wins in classifier)
    expect(r.consentRequired).toBe(true);
    expect(r.hitlRequired).toBe(false);
    expect(r.stepUpRequired).toBe(false);
  });

  it('PingOne: stepUpRequired=true for STEP_UP obligation; consentRequired=false', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 300 }), text: async () => '{}' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', status: 'SUCCESS', decision: 'PERMIT', obligations: [{ type: 'STEP_UP' }], advice: [] }),
        text: async () => '{}',
      });

    const r = await pingOneSvc.evaluateTransaction({ userId: 'u1', amount: 600, type: 'withdrawal', acr: '' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
    expect(r.hitlRequired).toBe(false);
  });

  it('PingOne: STEP_UP + HITL_CONSENT both in obligations → only stepUpRequired=true (highest-gate-wins)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 300 }), text: async () => '{}' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x', status: 'SUCCESS', decision: 'PERMIT',
          obligations: [{ type: 'HITL_CONSENT' }, { type: 'STEP_UP' }],
          advice: [],
        }),
        text: async () => '{}',
      });

    const r = await pingOneSvc.evaluateTransaction({ userId: 'u1', amount: 600, type: 'transfer', acr: '' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false); // step-up dominates
    expect(r.hitlRequired).toBe(false);
  });
});
