'use strict';

/**
 * @file adminConfig.generateKeypair.test.js
 * @description Regression (finding #32): POST /api/admin/config/generate-keypair
 * called configStore.setConfig(...) without awaiting it, so a persistence
 * failure was never observed -- the route always responded ok:true regardless
 * of whether the private key actually saved.
 *
 * Mirrors the mocking approach in adminConfig.lastEnvReconcile.test.js.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/configStore', () => ({
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  isConfigured:      jest.fn().mockReturnValue(false), // unconfigured → gate passes
  setConfig:         jest.fn(),
  FIELD_DEFS:        {},
}));

jest.mock('../../services/oauthRedirectUris', () => ({
  getOAuthRedirectDebugInfo: jest.fn().mockReturnValue({ redirectUri: 'http://localhost:4000/callback' }),
}));
jest.mock('../../config/hosting', () => ({
  isReplit:                        jest.fn().mockReturnValue(false),
  isDeploymentManagedPingOneOAuth: jest.fn().mockReturnValue(false),
  useConfigPasswordHeader:         jest.fn().mockReturnValue(false),
}));
jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());
jest.mock('axios');
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (_req, _res, next) => next(),
}));
jest.mock('../../services/pingoneBootstrapService', () => ({
  probeManagementApiAccess: jest.fn(),
}));
jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
}));
jest.mock('../../services/envValidation', () => ({
  getConfigurationStatus: jest.fn().mockReturnValue({ envId: null }),
  getValidationSummary:   jest.fn().mockReturnValue({
    valid: true, scenario: 'unconfigured', errorCount: 0, warningCount: 0,
    missingVars: [], recommendations: [],
  }),
}));

const configStore = require('../../services/configStore');
const adminConfigRouter = require('../../routes/adminConfig');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminConfigRouter);
  return app;
}

describe('POST /api/admin/config/generate-keypair', () => {
  beforeEach(() => {
    configStore.setConfig.mockReset();
  });

  it('returns 200 ok:true and persists the key when setConfig succeeds', async () => {
    configStore.setConfig.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/generate-keypair');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(configStore.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ pingone_mgmt_private_key: expect.any(String) }),
    );
  });

  it('returns 500 (not a false ok:true) when setConfig rejects', async () => {
    // Without `await`, this rejection would never be observed by the route --
    // it would still respond 200 ok:true before the rejection even fires.
    configStore.setConfig.mockRejectedValue(new Error('LMDB write failed'));

    const res = await request(buildApp()).post('/generate-keypair');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
