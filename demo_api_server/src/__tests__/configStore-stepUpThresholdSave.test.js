/**
 * @file configStore-stepUpThresholdSave.test.js
 * @description confirm_stepup_threshold_usd was never registered in FIELD_DEFS,
 * so configStore.setConfig() silently dropped it (same bug class as
 * configStore-authorizeEndpointSave.test.js's decision-endpoint keys).
 * transactionConsentChallenge.js's getStepUpThreshold() reads this key for the
 * device_picker HITL MFA gate — with the key unregistered, adjusting the
 * step-up threshold anywhere in the app never affected that gate.
 */
'use strict';

describe('configStore confirm_stepup_threshold_usd registration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('setConfig persists confirm_stepup_threshold_usd, readable via getEffective', async () => {
    const configStore = require('../../services/configStore');
    await configStore.setConfig({ confirm_stepup_threshold_usd: '750' });
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('750');
  });

  it('defaults to 500 when never set (matches scopeTopology.stepUpThresholdUsd() fallback)', async () => {
    const configStore = require('../../services/configStore');
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('500');
  });
});
