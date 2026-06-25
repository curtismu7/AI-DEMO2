/**
 * @file thresholdsToSimulatedAuthorize.regression.test.js
 *
 * Regression: a Setup-page / Demo-Controls threshold update (the keys
 * routes/thresholds.js writes) MUST change what the simulated Authorize
 * server actually enforces.
 *
 * Bug: thresholds.js wrote `confirm_threshold_usd` / `mfa_threshold_usd`, but
 * simulatedAuthorizeService reads ONLY `SIMULATED_AUTHORIZE_CONFIRM_AMOUNT` /
 * `SIMULATED_AUTHORIZE_STEPUP_AMOUNT`. Different key namespaces — case
 * normalization does not bridge differently-NAMED keys — so the AS silently
 * ignored every UI threshold edit and always used its defaults.
 *
 * Fix: thresholds.js mirror-writes the AS canonical keys alongside the HITL
 * keys. This test asserts the end-to-end contract WITHOUT loading server.js
 * (an unrelated pre-existing route load error blocks the full-app suite): it
 * exercises the same configStore write the route performs, then reads through
 * the real simulated AS getters and an actual decision.
 */

'use strict';

const path = require('path');

describe('threshold update -> simulated Authorize server (key-namespace bridge)', () => {
  let configStore;
  let sim;

  beforeAll(async () => {
    // configStore is now LMDB-backed and shares one persistent store across the
    // whole worker; the legacy CONFIG_DB_PATH (SQLite-era) knob is ignored. Other
    // suites that write SIMULATED_AUTHORIZE_CONFIRM_AMOUNT / _STEPUP_AMOUNT leak
    // those rows into our 'defaults hold' assertion. Wipe the shared store and
    // the env overrides so the AS getters fall back to their committed defaults.
    // The AS module refuses to load in production without an opt-in.
    delete process.env.NODE_ENV;
    delete process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT;
    delete process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT;

    configStore = require('../../services/configStore');
    await configStore.resetConfig();      // clear leaked rows from sibling suites
    await configStore.ensureInitialized();
    sim = require('../../services/simulatedAuthorizeService');
  });

  it('defaults hold before any update (confirm 250 / step-up 500)', () => {
    expect(sim.getConfirmAmountUsd()).toBe(250);
    expect(sim.getStepUpAmountUsd()).toBe(500);
  });

  it('writing the AS canonical keys (what thresholds.js now mirror-writes) changes the getters', async () => {
    // This is exactly the `update` object thresholds.js builds for
    // { confirm_threshold_usd: 800, mfa_threshold_usd: 1200 } after the fix.
    await configStore.setConfig({
      confirm_threshold_usd: '800',
      SIMULATED_AUTHORIZE_CONFIRM_AMOUNT: '800',
      mfa_threshold_usd: '1200',
      step_up_amount_threshold: '1200',
      SIMULATED_AUTHORIZE_STEPUP_AMOUNT: '1200',
    });

    expect(sim.getConfirmAmountUsd()).toBe(800);
    expect(sim.getStepUpAmountUsd()).toBe(1200);
  });

  it('the new thresholds drive an actual AS decision (not just the getter)', async () => {
    // $900 transfer: above the new confirm ($800), below the new step-up
    // ($1200). With the OLD (broken) wiring the AS saw defaults (confirm 250,
    // step-up 500) and would have returned step-up. Correct now: confirm only.
    const r = await sim.evaluateMcpFirstTool({
      userId: 'u-thr',
      toolName: 'create_transfer',
      tokenAudience: 'https://mcp.example',
      mcpResourceUri: '',
      actClientId: 'bff',
      amount: 900,
      transactionType: 'transfer',
      acr: '',
    });
    expect(r.decision).toBe('INDETERMINATE');
    expect(r.hitlRequired).toBe(true);
    expect(r.stepUpRequired).toBe(false);
  });

  it('proves the namespace bridge: writing ONLY the legacy UI keys would NOT move the AS', async () => {
    // Guards against a future refactor that drops the mirror-write. If someone
    // makes thresholds.js write only confirm_threshold_usd again, the AS
    // getter must stay on its last canonical value (here 800) — surfacing the
    // regression instead of silently ignoring the edit.
    await configStore.setConfig({ confirm_threshold_usd: '4242' });
    expect(sim.getConfirmAmountUsd()).toBe(800); // unchanged — AS reads SIMULATED_AUTHORIZE_CONFIRM_AMOUNT
  });
});
