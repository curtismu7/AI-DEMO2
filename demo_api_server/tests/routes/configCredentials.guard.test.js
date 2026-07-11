'use strict';

/**
 * C1 regression — POST /api/config/credentials/set must not be an unauthenticated
 * credential-overwrite primitive. It now shares adminConfig's requireAdminOrUnconfigured
 * gate: open during first-run setup, admin-only once the app is configured (in hosted mode).
 *
 * hosting is mocked to simulate a hosted deployment (isReplit=true) so the
 * configured-but-not-admin path is exercised deterministically. configStore.isConfigured
 * and setConfig are spied so no real config is read or written.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../config/hosting', () => ({
  isReplit: jest.fn(() => true),
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

describe('POST /api/config/credentials/set — requireAdminOrUnconfigured gate (C1)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('first-run (unconfigured): allowed so setup can seed credentials', async () => {
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

  test('configured + hosted + no admin session: 401 and NO credential write', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp({})).post('/api/config/credentials/set').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(setSpy).not.toHaveBeenCalled();
  });

  test('configured + admin session: allowed', async () => {
    jest.spyOn(configStore, 'isConfigured').mockReturnValue(true);
    const setSpy = jest.spyOn(configStore, 'setConfig').mockResolvedValue(undefined);

    const res = await request(makeApp({ isAdmin: true }))
      .post('/api/config/credentials/set')
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalled();
  });
});
