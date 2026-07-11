'use strict';

/**
 * H1 + M5 regression — POST /api/config/thresholds must not be an unauthenticated
 * primitive for disabling the HITL/step-up gate (e.g. raising mfa_threshold_usd
 * to a value no transaction reaches). It shares adminConfig's
 * requireAdminOrUnconfigured gate: open during first-run setup and in
 * non-production, admin-only once configured in production (M5: enforced on
 * every host, including self-hosted / non-Replit). GET stays open (not secret).
 *
 * hosting.isReplit is mocked false (self-hosted) to prove the M5 fix keys off
 * NODE_ENV, not the host. appEventService is mocked so no events persist;
 * configStore.isConfigured/setConfig and runtimeSettings.update are spied.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../config/hosting', () => ({
  isReplit: jest.fn(() => false),
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

describe('POST /api/config/thresholds — requireAdminOrUnconfigured gate (H1 + M5)', () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);
    jest.spyOn(runtimeSettings, 'update').mockImplementation(() => {});
  });
  afterEach(() => { process.env.NODE_ENV = ORIG_NODE_ENV; jest.restoreAllMocks(); });

  test('first-run (unconfigured): allowed even in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(false);

    const res = await request(makeApp()).post('/api/config/thresholds').send(ATTACK_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(configStore.setConfig).toHaveBeenCalled();
  });

  test('non-production (dev): open even when configured', async () => {
    process.env.NODE_ENV = 'development';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({})).post('/api/config/thresholds').send(ATTACK_BODY);

    expect(res.status).toBe(200);
    expect(configStore.setConfig).toHaveBeenCalled();
  });

  test('production + self-hosted (non-Replit) + configured + no admin: 401, NOT changed (M5)', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({})).post('/api/config/thresholds').send(ATTACK_BODY);

    expect(res.status).toBe(401);
    expect(configStore.setConfig).not.toHaveBeenCalled();
    expect(runtimeSettings.update).not.toHaveBeenCalled();
  });

  test('production + configured + admin session: allowed', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({ isAdmin: true }))
      .post('/api/config/thresholds')
      .send(ATTACK_BODY);

    expect(res.status).toBe(200);
    expect(configStore.setConfig).toHaveBeenCalled();
  });

  test('GET stays open (unauthenticated read allowed)', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);

    const res = await request(makeApp({})).get('/api/config/thresholds');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mfa_threshold_usd');
  });
});
