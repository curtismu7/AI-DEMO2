'use strict';

/**
 * H1 regression — POST /api/config/thresholds must not be an unauthenticated
 * primitive for disabling the HITL/step-up gate (e.g. raising mfa_threshold_usd
 * to a value no transaction reaches). It now shares adminConfig's
 * requireAdminOrUnconfigured gate: open during first-run setup, admin-only once
 * the app is configured (in hosted mode). GET stays open (thresholds aren't secret).
 *
 * hosting is mocked to simulate a hosted deployment; appEventService is mocked so
 * no events persist; configStore.isConfigured/setConfig and runtimeSettings.update
 * are spied so no real config or runtime state is written.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../config/hosting', () => ({
  isReplit: jest.fn(() => true),
  useConfigPasswordHeader: jest.fn(() => false),
  isDeploymentManagedPingOneOAuth: jest.fn(() => false),
}));
jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { THRESHOLD: 'threshold' },
}));

const configStore = require('../../services/configStore');
const runtimeSettings = require('../../config/runtimeSettings');
const thresholdsRouter = require('../../routes/thresholds');

function makeApp(session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/config/thresholds', thresholdsRouter);
  return app;
}

// The attack: raise the MFA/step-up threshold so no transaction ever trips it.
const ATTACK_BODY = { mfa_threshold_usd: 100000 };

describe('POST /api/config/thresholds — requireAdminOrUnconfigured gate (H1)', () => {
  beforeEach(() => {
    jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);
    jest.spyOn(runtimeSettings, 'update').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('first-run (unconfigured): allowed', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(false);

    const res = await request(makeApp()).post('/api/config/thresholds').send(ATTACK_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(configStore.setConfig).toHaveBeenCalled();
  });

  test('configured + hosted + no admin session: 401, threshold NOT changed', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({})).post('/api/config/thresholds').send(ATTACK_BODY);

    expect(res.status).toBe(401);
    expect(configStore.setConfig).not.toHaveBeenCalled();
    expect(runtimeSettings.update).not.toHaveBeenCalled();
  });

  test('configured + admin session: allowed', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({ isAdmin: true }))
      .post('/api/config/thresholds')
      .send(ATTACK_BODY);

    expect(res.status).toBe(200);
    expect(configStore.setConfig).toHaveBeenCalled();
  });

  test('GET stays open (unauthenticated read allowed)', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({})).get('/api/config/thresholds');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mfa_threshold_usd');
  });
});
