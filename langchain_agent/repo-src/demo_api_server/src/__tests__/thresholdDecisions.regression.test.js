/**
 * @file thresholdDecisions.regression.test.js
 *
 * Tests the consent / MFA threshold rules end-to-end.
 *
 * Business rule (defaults: confirm=$250, mfa=$500):
 *   - Below $250          → PERMIT
 *   - $250 – $499         → consent only (HITL human-approval modal)
 *   - $500+               → MFA only (step-up, no consent modal)
 *
 * The MFA gate replaces consent entirely — the user sees only the MFA
 * challenge, never a consent + MFA double-gate. This is enforced by
 * classifyObligations (STEP_UP > HITL_CONSENT).
 *
 * Also tests that the Demo Controls / Setup page threshold sliders
 * (POST /api/config/thresholds) actually change what the authorize
 * service enforces at runtime.
 */

'use strict';

const os = require('os');
const path = require('path');

// ── Isolate to a temp SQLite DB ───────────────────────────────────────────────
const tmpDb = path.join(os.tmpdir(), `cfg-threshold-decisions-${Date.now()}.db`);
process.env.CONFIG_DB_PATH = tmpDb;
// Allow simulated Authorize to load outside production
delete process.env.NODE_ENV;
// Clear env vars so configStore/AS defaults are pure
delete process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT;
delete process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT;
delete process.env.CONFIRM_THRESHOLD_USD;
delete process.env.STEP_UP_AMOUNT_THRESHOLD;
delete process.env.MFA_THRESHOLD_USD;

// ── Load modules after env is clean ──────────────────────────────────────────
let configStore, sim, runtimeSettings;

beforeAll(async () => {
  configStore = require('../../services/configStore');
  await configStore.ensureInitialized();
  sim = require('../../services/simulatedAuthorizeService');
  runtimeSettings = require('../../config/runtimeSettings');
});

/**
 * Helper: write thresholds the same way POST /api/config/thresholds does.
 * Mirrors the mirror-write contract from routes/thresholds.js.
 */
async function setThresholds({ confirm, mfa, deny } = {}) {
  const update = {};
  if (confirm !== undefined) {
    update.confirm_threshold_usd = String(confirm);
    update.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = String(confirm);
  }
  if (mfa !== undefined) {
    update.mfa_threshold_usd = String(mfa);
    update.step_up_amount_threshold = String(mfa);
    update.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = String(mfa);
    runtimeSettings.update({ stepUpAmountThreshold: Number(mfa) }, 'test-helper');
  }
  if (deny !== undefined) {
    update.SIMULATED_AUTHORIZE_DENY_AMOUNT = String(deny);
  }
  await configStore.setConfig(update);
}

afterAll(async () => {
  // Restore defaults so other test files that share the process are not polluted
  await setThresholds({ confirm: 250, mfa: 500, deny: 2000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEFAULT THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
describe('Default thresholds — $250 consent, $500 MFA', () => {
  beforeAll(() => setThresholds({ confirm: 250, mfa: 500 }));

  it('confirm default is $250', () => {
    expect(sim.getConfirmAmountUsd()).toBe(250);
  });

  it('step-up default is $500', () => {
    expect(sim.getStepUpAmountUsd()).toBe(500);
  });

  it('$249.99 withdrawal → PERMIT (below both thresholds)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 249.99, type: 'withdrawal' });
    expect(r.decision).toBe('PERMIT');
    expect(r.consentRequired).toBe(false);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$250 withdrawal → consent required (at consent threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 250, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$499 withdrawal → consent only, no step-up (between thresholds)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 499, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$500 withdrawal → step-up only, not consent (at MFA threshold — highest gate wins)', async () => {
    // Step-up wins over consent via classifyObligations (STEP_UP > HITL_CONSENT).
    // The user sees MFA only — no separate consent modal.
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('$501 withdrawal → step-up only (above MFA threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 501, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('transfer of any amount (even $1) → consent required (type-based rule)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('transfer of $500 → step-up wins over consent (highest-gate-wins)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'transfer' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('strong ACR bypasses step-up, falling back to consent ($250–$499 zone still applies)', async () => {
    // acrLooksStrong suppresses the step-up gate, not the consent gate.
    // $300 with strong ACR: step-up skipped, consent still required ($300 >= $250).
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 300, type: 'withdrawal', acr: 'Multi_factor' });
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CHANGING THRESHOLDS VIA THE API MIRROR-WRITE CONTRACT
//    (replicates what POST /api/config/thresholds does, without loading server.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('Changing consent threshold from $250 to $800', () => {
  beforeAll(() => setThresholds({ confirm: 800, mfa: 500 }));
  afterAll(() => setThresholds({ confirm: 250, mfa: 500 }));

  it('getConfirmAmountUsd reflects the new value', () => {
    expect(sim.getConfirmAmountUsd()).toBe(800);
  });

  it('$500 withdrawal → step-up only (MFA threshold unchanged at $500)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('$750 withdrawal → step-up only ($750 >= $500 MFA, below new $800 consent)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 750, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('$800 withdrawal → step-up only (MFA wins even though consent threshold also fires at $800)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 800, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });
});

describe('Raising MFA threshold from $500 to $1000', () => {
  beforeAll(() => setThresholds({ confirm: 250, mfa: 1000 }));
  afterAll(() => setThresholds({ confirm: 250, mfa: 500 }));

  it('getStepUpAmountUsd reflects the new value', () => {
    expect(sim.getStepUpAmountUsd()).toBe(1000);
  });

  it('$500 withdrawal → consent only (below new $1000 MFA threshold)', async () => {
    // Was step-up at default — now consent only because $500 < $1000
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$999 withdrawal → consent only (just below MFA)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 999, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$1000 withdrawal → step-up only (at new MFA threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 1000, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('runtimeSettings.stepUpAmountThreshold also updated to 1000', () => {
    expect(runtimeSettings.get('stepUpAmountThreshold')).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ABOVE $500 IS MFA ONLY — never also consent
//    This is the key business rule: once the step-up gate fires it replaces
//    consent entirely (classifyObligations: STEP_UP > HITL_CONSENT).
//    A customer at ≥$500 sees only the MFA challenge, not a consent modal too.
// ─────────────────────────────────────────────────────────────────────────────
describe('Above $500 = MFA only, not consent (highest-gate-wins)', () => {
  beforeAll(() => setThresholds({ confirm: 250, mfa: 500 }));

  const mfaOnlyCases = [500, 501, 600, 999, 1000, 1500, 1999];
  for (const amount of mfaOnlyCases) {
    it(`$${amount} withdrawal → stepUpRequired=true, consentRequired=false`, async () => {
      const r = await sim.evaluateTransaction({ userId: 'u1', amount, type: 'withdrawal' });
      expect(r.stepUpRequired).toBe(true);
      expect(r.consentRequired).toBe(false);
    });
  }

  it('$500 deposit → step-up only (amount-based, not type-based)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'deposit' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('$250–$499 deposit → consent only (between thresholds)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 300, type: 'deposit' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('transfer at $500 → step-up only (type rule loses to amount step-up)', async () => {
    // Transfer type always produces consent, but the $500 step-up gate wins.
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 500, type: 'transfer' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });
});

describe('Setting both thresholds together', () => {
  beforeAll(() => setThresholds({ confirm: 100, mfa: 300 }));
  afterAll(() => setThresholds({ confirm: 250, mfa: 500 }));

  it('$99 withdrawal → PERMIT', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 99, type: 'withdrawal' });
    expect(r.decision).toBe('PERMIT');
  });

  it('$100 withdrawal → consent only (at new $100 consent threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 100, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$150 withdrawal → consent only (between $100 and $300)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 150, type: 'withdrawal' });
    expect(r.consentRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('$300 withdrawal → step-up only (at $300 MFA threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 300, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });

  it('above $300 always step-up only (not consent)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 999, type: 'withdrawal' });
    expect(r.stepUpRequired).toBe(true);
    expect(r.consentRequired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. HARD DENY — $2000+ is not allowed for ANY action
//    The deny gate is the first check and applies to all transaction types.
//    No consent, no MFA — just a hard DENY. This is enforced by the
//    simulated service before any obligation logic runs.
// ─────────────────────────────────────────────────────────────────────────────
describe('Hard DENY — over $2000 is not allowed for any action (default deny threshold)', () => {
  beforeAll(() => setThresholds({ confirm: 250, mfa: 500, deny: 2000 }));

  it('getDenyAmountUsd default is $2000', () => {
    expect(sim.getDenyAmountUsd()).toBe(2000);
  });

  it('$2000 withdrawal → step-up only (exactly at threshold is NOT denied — deny is >2000)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 2000, type: 'withdrawal' });
    expect(r.decision).not.toBe('DENY');
    expect(r.stepUpRequired).toBe(true);
  });

  it('$2001 withdrawal → DENY', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 2001, type: 'withdrawal' });
    expect(r.decision).toBe('DENY');
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  it('$2001 deposit → DENY (deny applies to all types)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 2001, type: 'deposit' });
    expect(r.decision).toBe('DENY');
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  it('$2001 transfer → DENY (transfer type rule overridden by deny gate)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 2001, type: 'transfer' });
    expect(r.decision).toBe('DENY');
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  const denyCases = [2001, 5000, 9999, 100000];
  for (const amount of denyCases) {
    it(`$${amount} → DENY (any amount over $2000)`, async () => {
      const r = await sim.evaluateTransaction({ userId: 'u1', amount, type: 'withdrawal' });
      expect(r.decision).toBe('DENY');
      expect(r.stepUpRequired).toBe(false);
      expect(r.consentRequired).toBe(false);
    });
  }
});

describe('Configurable deny threshold — can be raised or lowered', () => {
  beforeAll(() => setThresholds({ confirm: 250, mfa: 500, deny: 1000 }));
  afterAll(() => setThresholds({ confirm: 250, mfa: 500, deny: 2000 }));

  it('getDenyAmountUsd reflects new threshold of $1000', () => {
    expect(sim.getDenyAmountUsd()).toBe(1000);
  });

  it('$999 withdrawal → step-up only (below new $1000 deny)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 999, type: 'withdrawal' });
    expect(r.decision).not.toBe('DENY');
    expect(r.stepUpRequired).toBe(true);
  });

  it('$1001 withdrawal → DENY (over new $1000 threshold)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 1001, type: 'withdrawal' });
    expect(r.decision).toBe('DENY');
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });

  it('$1001 transfer → DENY (deny gate runs before type-based consent rule)', async () => {
    const r = await sim.evaluateTransaction({ userId: 'u1', amount: 1001, type: 'transfer' });
    expect(r.decision).toBe('DENY');
    expect(r.stepUpRequired).toBe(false);
    expect(r.consentRequired).toBe(false);
  });
});
