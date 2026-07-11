'use strict';

/**
 * C1 + M5 regression — POST /api/config/credentials/set must not be an
 * unauthenticated credential-overwrite primitive. It shares adminConfig's
 * requireAdminOrUnconfigured gate: open during first-run setup and in
 * non-production, admin-only once configured in production (M5: enforced on
 * EVERY host, including self-hosted / non-Replit, not just Replit).
 *
 * hosting.isReplit is mocked false (self-hosted) to prove the M5 fix keys off
 * NODE_ENV, not the host. configStore.isConfigured/setConfig are spied so no
 * real config is read or written.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../config/hosting', () => ({
  isReplit: jest.fn(() => false),
  useConfigPasswordHeader: jest.fn(() => false),
  isDeploymentManagedPingOneOAuth: jest.fn(() => false),
}));

const configStore = require('../../services/configStore');
const credsRouter = require('../../routes/configCredentials');

function makeApp(session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/config/credentials', credsRouter);
  return app;
}

const VALID_BODY = {
  credentialType: 'customer_oauth',
  credentials: { client_id: 'cid-123', client_secret: 'secret-xyz' },
};

describe('POST /api/config/credentials/set — requireAdminOrUnconfigured gate (C1 + M5)', () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIG_NODE_ENV; jest.restoreAllMocks(); });

  test('first-run (unconfigured): allowed even in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(false);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp()).post('/api/config/credentials/set').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(setSpy).toHaveBeenCalledWith({
      PINGONE_CLIENT_ID: 'cid-123',
      PINGONE_CLIENT_SECRET: 'secret-xyz',
    });
  });

  test('non-production (dev): open even when configured', async () => {
    process.env.NODE_ENV = 'development';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp({})).post('/api/config/credentials/set').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalled();
  });

  test('production + self-hosted (non-Replit) + configured + no admin: 401, NO write (M5)', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp({})).post('/api/config/credentials/set').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(setSpy).not.toHaveBeenCalled();
  });

  test('production + configured + admin session: allowed', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp({ isAdmin: true }))
      .post('/api/config/credentials/set')
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalled();
  });
});
