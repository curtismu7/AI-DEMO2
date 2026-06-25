'use strict';

/**
 * TDD test: GET /api/admin/config exposes lastEnvReconcile.
 *
 * Strategy: supertest route test — mounts the real adminConfig router on a
 * minimal express app and exercises the actual GET handler.  Heavy deps
 * (configStore.ensureInitialized, getConfigurationStatus, getValidationSummary,
 * getOAuthRedirectDebugInfo, hosting) are mocked so the handler returns cleanly
 * without real LMDB/network IO.
 *
 * RED before the field is added to adminConfig.js.
 * GREEN after.
 */

const request = require('supertest');
const express = require('express');

// ---------------------------------------------------------------------------
// Mock heavy deps before requiring the router
// ---------------------------------------------------------------------------

jest.mock('../../services/configStore', () => ({
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  getMasked:         jest.fn().mockReturnValue({ pingone_environment_id: '••••••••' }),
  isConfigured:      jest.fn().mockReturnValue(false), // unconfigured → gate passes
  getStorageType:    jest.fn().mockReturnValue('lmdb'),
  isReadOnly:        jest.fn().mockReturnValue(false),
  lastEnvReconcile:  null, // will be overridden per-test
  FIELD_DEFS:        {},
}));

jest.mock('../../services/envValidation', () => ({
  getConfigurationStatus: jest.fn().mockReturnValue({ envId: null }),
  getValidationSummary:   jest.fn().mockReturnValue({
    valid: true,
    scenario: 'unconfigured',
    errorCount: 0,
    warningCount: 0,
    missingVars: [],
    recommendations: [],
  }),
}));

jest.mock('../../services/oauthRedirectUris', () => ({
  getOAuthRedirectDebugInfo: jest.fn().mockReturnValue({ redirectUri: 'http://localhost:4000/callback' }),
}));

jest.mock('../../config/hosting', () => ({
  isReplit:                        jest.fn().mockReturnValue(false),
  isDeploymentManagedPingOneOAuth: jest.fn().mockReturnValue(false),
  useConfigPasswordHeader:         jest.fn().mockReturnValue(false),
}));

// Prevent real rateLimit from importing
jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

// Prevent real axios from being required (not used in GET but imported at module top)
jest.mock('axios');

// Misc services referenced but not on the GET path
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (_req, _res, next) => next(),
}));
jest.mock('../../services/pingoneBootstrapService', () => ({
  probeManagementApiAccess: jest.fn(),
}));
jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
}));
jest.mock('../../services/configHostnameService', () => ({
  getConfiguredHostname: jest.fn().mockReturnValue('http://localhost:4000'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/config — lastEnvReconcile field', () => {
  let app;
  let configStore;

  beforeEach(() => {
    jest.resetModules(); // ensure fresh require between tests
    // Re-require after resetting modules so module-level mocks still apply
    // (they were registered before any require, so resetModules is safe here).
    configStore = require('../../services/configStore');
    const adminConfigRouter = require('../../routes/adminConfig');
    app = express();
    app.use(express.json());
    app.use('/', adminConfigRouter);
  });

  afterEach(() => {
    // Clean up any mutation to the singleton
    configStore.lastEnvReconcile = null;
  });

  it('includes lastEnvReconcile in the response when a reconcile record exists', async () => {
    const record = {
      verdict:     'reconcile',
      fromEnvId:   'old-env-id',
      toEnvId:     'new-env-id',
      purgedKeys:  ['pingone_mcp_token_exchanger_client_id'],
      vaultDropped: [],
      at:          '2026-06-19T00:00:00.000Z',
    };
    configStore.lastEnvReconcile = record;

    const res = await request(app).get('/').expect(200);

    expect(res.body.lastEnvReconcile).toBeDefined();
    expect(res.body.lastEnvReconcile).toEqual(record);
  });

  it('returns null for lastEnvReconcile when no reconcile has occurred', async () => {
    configStore.lastEnvReconcile = null;

    const res = await request(app).get('/').expect(200);

    expect(res.body.lastEnvReconcile).toBeNull();
  });

  it('serialized payload contains only key names, no secret values', async () => {
    const record = {
      verdict:      'reconcile',
      fromEnvId:    'old-env-id',
      toEnvId:      'new-env-id',
      purgedKeys:   ['pingone_mcp_token_exchanger_client_id'],
      vaultDropped: [],
      at:           '2026-06-19T00:00:00.000Z',
    };
    configStore.lastEnvReconcile = record;

    const res = await request(app).get('/').expect(200);

    const body = JSON.stringify(res.body.lastEnvReconcile);
    // No value resembling a secret (no long opaque strings, no bearer-token patterns)
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/password/i);
    expect(body).not.toMatch(/bearer/i);
  });
});
