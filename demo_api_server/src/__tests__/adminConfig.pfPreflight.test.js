'use strict';

/**
 * Regression (2026-09-25 SE CrashLoop): the UI's provider toggle persisted
 * oauth_provider=pingfederate into LMDB even when the PF_* endpoints are
 * unreachable from the deployment. The next /health check then dialed the dead
 * PF discovery URL, 503'd, and the K8s startup probe CrashLooped the BFF.
 *
 * Fix under test: POST /api/admin/config must refuse a switch TO pingfederate
 * (HTTP 422, error 'pf_unreachable') when the resolved PF discovery endpoint
 * does not respond. Switching back to pingone, and saving unrelated keys, must
 * never be blocked.
 *
 * Strategy: supertest route test with the real adminConfig router. axios is
 * mocked so the pre-flight probe is controlled per-test; FIELD_DEFS is stubbed
 * to include OAUTH_PROVIDER so the key survives the whitelist filter.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/configStore', () => {
  const FIELD_DEFS = { OAUTH_PROVIDER: { label: 'OAUTH_PROVIDER', type: 'select' } };
  return {
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
    getMasked:         jest.fn().mockReturnValue({}),
    isConfigured:      jest.fn().mockReturnValue(false), // unconfigured → gate passes
    getStorageType:    jest.fn().mockReturnValue('lmdb'),
    isReadOnly:        jest.fn().mockReturnValue(false),
    setConfig:         jest.fn().mockResolvedValue(undefined),
    getEffective:      jest.fn((key) => key === 'pf_issuer' ? 'https://pf.example.com' : ''),
    FIELD_DEFS,
  };
});

jest.mock('../../services/envValidation', () => ({
  getConfigurationStatus: jest.fn().mockReturnValue({ envId: null }),
  getValidationSummary:   jest.fn().mockReturnValue({
    valid: true, scenario: 'unconfigured', errorCount: 0, warningCount: 0,
    missingVars: [], recommendations: [],
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

jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

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

// The pre-flight probe calls axios.get. Control success/failure per test via
// the mocked getDiscoveryEndpoint + axios.
const mockAxios = require('axios');
jest.mock('../../services/oauthEndpointResolver', () => ({
  getDiscoveryEndpoint: jest.fn().mockReturnValue('https://pf.example.com/.well-known/openid-configuration'),
}));

describe('POST /api/admin/config — PingFederate pre-flight reachability gate', () => {
  let app;
  // Captured at module scope so the global afterEach jest.resetModules()
  // (src/__tests__/setup.js) cannot hand the tests a fresh configStore mock
  // instance while the router mounted in beforeAll keeps the original.
  let configStore;

  beforeAll(() => {
    configStore = require('../../services/configStore');
    const adminConfig = require('../../routes/adminConfig');
    app = express();
    app.use(express.json());
    app.use('/api/admin/config', adminConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.get = jest.fn();
  });

  test('rejects oauth_provider=pingfederate with 422 pf_unreachable when discovery fails', async () => {
    const dnsError = new Error('getaddrinfo ENOTFOUND local.ping-devops.com');
    dnsError.code = 'ENOTFOUND';
    mockAxios.get.mockRejectedValue(dnsError);

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pf_unreachable');
    // The config must NOT have been persisted
    expect(configStore.setConfig).not.toHaveBeenCalled();
  });

  test('accepts oauth_provider=pingfederate when PF discovery responds', async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: {
        issuer: 'https://pf.example.com',
        authorization_endpoint: 'https://pf.example.com/authorize',
        token_endpoint: 'https://pf.example.com/token',
        jwks_uri: 'https://pf.example.com/jwks',
      },
    });

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(configStore.setConfig).toHaveBeenCalledWith(expect.objectContaining({
      OAUTH_PROVIDER: 'pingfederate',
      PF_ISSUER: 'https://pf.example.com',
      PF_AUTHORIZATION_ENDPOINT: 'https://pf.example.com/authorize',
      PF_TOKEN_ENDPOINT: 'https://pf.example.com/token',
      PF_JWKS_URI: 'https://pf.example.com/jwks',
    }));
    expect(require('../../services/oauthEndpointResolver').getDiscoveryEndpoint)
      .toHaveBeenCalledWith('pingfederate');
  });

  test('does NOT probe when switching back to pingone', async () => {
    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingone' });

    expect(res.status).toBe(200);
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(configStore.setConfig.mock.calls).toContainEqual([{ OAUTH_PROVIDER: 'pingone' }]);
  });

  test('does NOT probe when the payload has no provider key (other config keys)', async () => {
    const res = await request(app)
      .post('/api/admin/config')
      .send({ authorize_mode: 'simulated' });

    expect(res.status).toBe(200);
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  test('treats a 5xx discovery response as unreachable', async () => {
    // validateStatus accepts < 500, so a 503 rejects inside axios
    const serverError = new Error('Request failed with status code 503');
    serverError.code = 'ECONNABORTED';
    mockAxios.get.mockRejectedValue(serverError);

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pf_unreachable');
  });

  test('rejects a successful HTTP response that is not valid OIDC metadata', async () => {
    mockAxios.get.mockResolvedValue({ status: 200, data: {} });

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pf_unreachable');
    expect(configStore.setConfig).not.toHaveBeenCalled();
  });

  test('rejects discovery metadata whose issuer differs from the configured PF issuer', async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: {
        issuer: 'https://auth.pingone.com/env-1/as',
        authorization_endpoint: 'https://auth.pingone.com/env-1/as/authorize',
        token_endpoint: 'https://auth.pingone.com/env-1/as/token',
        jwks_uri: 'https://auth.pingone.com/env-1/as/jwks',
      },
    });

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pf_unreachable');
    expect(configStore.setConfig).not.toHaveBeenCalled();
  });

  test('rejects when PF discovery endpoint is not configured at all', async () => {
    const resolver = require('../../services/oauthEndpointResolver');
    resolver.getDiscoveryEndpoint.mockReturnValueOnce('');

    const res = await request(app)
      .post('/api/admin/config')
      .send({ oauth_provider: 'pingfederate' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pf_unreachable');
    expect(res.body.message).toMatch(/not configured/i);
  });
});
