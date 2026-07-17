/**
 * @file adminSettings.stepUpThresholdBridge.test.js
 * @description PUT /api/admin/settings only updated runtimeSettings (in-process
 * only) for stepUpAmountThreshold -- it never mirrored into configStore, so
 * confirm_stepup_threshold_usd (read by transactionConsentChallenge.js's
 * device_picker gate) never reflected what SecuritySettings.js set. This is
 * the same dual-store-bridge pattern already applied to maxTransactionAmount
 * in this same handler.
 */
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => { req.user = { email: 'admin@test.com' }; next(); },
  requireScopes: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => { req.user = { email: 'admin@test.com' }; next(); },
}));

describe('PUT /api/admin/settings — stepUpAmountThreshold dual-store bridge', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    const router = require('../../routes/admin');
    app = express();
    app.use(express.json());
    app.use('/api/admin', router);
  });

  it('mirrors stepUpAmountThreshold into configStore.confirm_stepup_threshold_usd', async () => {
    const configStore = require('../../services/configStore');
    await request(app)
      .put('/api/admin/settings')
      .send({ stepUpAmountThreshold: 900 })
      .expect(200);
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('900');
    expect(configStore.getEffective('mfa_threshold_usd')).toBe('900');
    expect(configStore.getEffective('step_up_amount_threshold')).toBe('900');
    expect(configStore.getEffective('SIMULATED_AUTHORIZE_STEPUP_AMOUNT')).toBe('900');
  });

  it('does not touch configStore when stepUpAmountThreshold is absent from the body', async () => {
    const configStore = require('../../services/configStore');
    const before = configStore.getEffective('confirm_stepup_threshold_usd');
    await request(app)
      .put('/api/admin/settings')
      .send({ stepUpAcrValue: 'Multi_Factor' })
      .expect(200);
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe(before);
  });
});
