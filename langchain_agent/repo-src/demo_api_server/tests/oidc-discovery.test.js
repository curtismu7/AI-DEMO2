'use strict';
/**
 * OIDC Discovery Tests (Phase 169-02)
 *
 * Tests oauthDiscoveryService and oauthEndpointResolver discovery cache.
 * No live credentials — axios is mocked throughout.
 *
 * Pattern: jest.resetModules() + jest.mock('axios') in beforeEach so that
 * freshly-required service modules share the same mock instance as the test.
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

// ── oauthDiscoveryService ──────────────────────────────────────────────────

describe('oauthDiscoveryService', () => {
  let discoveryService;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('axios');
    mockAxios = require('axios');
    delete process.env.OAUTH_ISSUER;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    delete process.env.OAUTH_ISSUER;
    delete process.env.NODE_ENV;
  });

  function mockMetadata(overrides = {}) {
    return {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
      userinfo_endpoint: 'https://auth.example.com/userinfo',
      ...overrides,
    };
  }

  // ── Test 1 ────────────────────────────────────────────────────────────────
  test('returns null when no discoveryUrl and no oauth_issuer configured', async () => {
    discoveryService = require('../services/oauthDiscoveryService');
    const result = await discoveryService.fetchDiscoveryMetadata();
    expect(result).toBeNull();
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  test('constructs discovery URL from oauth_issuer when no URL provided', async () => {
    process.env.OAUTH_ISSUER = 'https://auth.example.com';
    mockAxios.get.mockResolvedValue({ data: mockMetadata() });
    discoveryService = require('../services/oauthDiscoveryService');

    await discoveryService.fetchDiscoveryMetadata();

    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/openid-configuration',
      expect.objectContaining({ timeout: 5000 })
    );
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  test('uses explicit discoveryUrl when provided', async () => {
    const url = 'https://custom.example.com/.well-known/openid-configuration';
    mockAxios.get.mockResolvedValue({ data: mockMetadata({ issuer: 'https://custom.example.com' }) });
    discoveryService = require('../services/oauthDiscoveryService');

    await discoveryService.fetchDiscoveryMetadata(url);

    expect(mockAxios.get).toHaveBeenCalledWith(url, expect.anything());
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  test('strips trailing slash from issuer when building discovery URL', async () => {
    process.env.OAUTH_ISSUER = 'https://auth.example.com/';
    mockAxios.get.mockResolvedValue({ data: mockMetadata() });
    discoveryService = require('../services/oauthDiscoveryService');

    await discoveryService.fetchDiscoveryMetadata();

    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/openid-configuration',
      expect.anything()
    );
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  test('rejects http:// discovery URL in production', async () => {
    process.env.NODE_ENV = 'production';
    discoveryService = require('../services/oauthDiscoveryService');

    const result = await discoveryService.fetchDiscoveryMetadata(
      'http://insecure.example.com/.well-known/openid-configuration'
    );

    expect(result).toBeNull();
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  test('allows http:// discovery URL in development', async () => {
    process.env.NODE_ENV = 'development';
    mockAxios.get.mockResolvedValue({ data: mockMetadata({ issuer: 'http://localhost:9031' }) });
    discoveryService = require('../services/oauthDiscoveryService');

    await discoveryService.fetchDiscoveryMetadata(
      'http://localhost:9031/.well-known/openid-configuration'
    );

    expect(mockAxios.get).toHaveBeenCalled();
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  test('returns null when required field missing from metadata', async () => {
    const incomplete = mockMetadata();
    delete incomplete.jwks_uri;
    mockAxios.get.mockResolvedValue({ data: incomplete });
    discoveryService = require('../services/oauthDiscoveryService');

    const result = await discoveryService.fetchDiscoveryMetadata(
      'https://auth.example.com/.well-known/openid-configuration'
    );

    expect(result).toBeNull();
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  test('returns null when discovered issuer does not match configured oauth_issuer', async () => {
    process.env.OAUTH_ISSUER = 'https://correct.example.com';
    mockAxios.get.mockResolvedValue({ data: mockMetadata({ issuer: 'https://wrong.example.com' }) });
    discoveryService = require('../services/oauthDiscoveryService');

    const result = await discoveryService.fetchDiscoveryMetadata(
      'https://correct.example.com/.well-known/openid-configuration'
    );

    expect(result).toBeNull();
  });

  // ── Test 9 ────────────────────────────────────────────────────────────────
  test('accepts issuer with or without trailing slash (normalization)', async () => {
    process.env.OAUTH_ISSUER = 'https://auth.example.com/';
    mockAxios.get.mockResolvedValue({ data: mockMetadata({ issuer: 'https://auth.example.com' }) });
    discoveryService = require('../services/oauthDiscoveryService');

    const result = await discoveryService.fetchDiscoveryMetadata(
      'https://auth.example.com/.well-known/openid-configuration'
    );

    expect(result).not.toBeNull();
    expect(result.issuer).toBe('https://auth.example.com');
  });

  // ── Test 10 ───────────────────────────────────────────────────────────────
  test('returns null and does not throw on network error', async () => {
    mockAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    discoveryService = require('../services/oauthDiscoveryService');

    const result = await discoveryService.fetchDiscoveryMetadata(
      'https://auth.example.com/.well-known/openid-configuration'
    );

    expect(result).toBeNull();
  });

  // ── Test 11 ───────────────────────────────────────────────────────────────
  test('extractEndpoints returns normalized object from metadata', () => {
    discoveryService = require('../services/oauthDiscoveryService');
    const metadata = mockMetadata();

    const endpoints = discoveryService.extractEndpoints(metadata);

    expect(endpoints).toEqual({
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
      userinfo_endpoint: 'https://auth.example.com/userinfo',
      issuer: 'https://auth.example.com',
    });
  });

  // ── Test 12 ───────────────────────────────────────────────────────────────
  test('extractEndpoints returns null when metadata is null', () => {
    discoveryService = require('../services/oauthDiscoveryService');
    expect(discoveryService.extractEndpoints(null)).toBeNull();
  });
});

// ── oauthEndpointResolver discovery cache ─────────────────────────────────

describe('oauthEndpointResolver — discovery cache', () => {
  let resolver;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('axios');
    mockAxios = require('axios');
    delete process.env.OAUTH_DISCOVERY_ENABLED;
    delete process.env.OAUTH_TOKEN_ENDPOINT;
    delete process.env.OAUTH_ISSUER;
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_REGION;
  });

  afterEach(() => {
    delete process.env.OAUTH_DISCOVERY_ENABLED;
    delete process.env.OAUTH_TOKEN_ENDPOINT;
    delete process.env.OAUTH_ISSUER;
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_REGION;
  });

  function mockMetadata(overrides = {}) {
    return {
      issuer: 'https://federate.example.com',
      authorization_endpoint: 'https://federate.example.com/as/authorization.oauth2',
      token_endpoint: 'https://federate.example.com/as/token.oauth2',
      jwks_uri: 'https://federate.example.com/pf/JWKS',
      userinfo_endpoint: 'https://federate.example.com/idp/userinfo.openid',
      ...overrides,
    };
  }

  // ── Test 13 ───────────────────────────────────────────────────────────────
  test('initializeDiscovery no-ops when oauth_discovery_enabled != true', async () => {
    process.env.OAUTH_DISCOVERY_ENABLED = 'false';
    resolver = require('../services/oauthEndpointResolver');

    await resolver.initializeDiscovery();

    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  // ── Test 14 ───────────────────────────────────────────────────────────────
  test('initializeDiscovery populates cache when enabled', async () => {
    process.env.OAUTH_DISCOVERY_ENABLED = 'true';
    process.env.OAUTH_ISSUER = 'https://federate.example.com';
    mockAxios.get.mockResolvedValue({ data: mockMetadata() });
    resolver = require('../services/oauthEndpointResolver');

    await resolver.initializeDiscovery();

    expect(resolver.getTokenEndpoint()).toBe('https://federate.example.com/as/token.oauth2');
    expect(resolver.getJwksUri()).toBe('https://federate.example.com/pf/JWKS');
  });

  // ── Test 15 ───────────────────────────────────────────────────────────────
  test('explicit config overrides discovery cache', async () => {
    process.env.OAUTH_DISCOVERY_ENABLED = 'true';
    process.env.OAUTH_ISSUER = 'https://federate.example.com';
    process.env.OAUTH_TOKEN_ENDPOINT = 'https://override.example.com/token';
    mockAxios.get.mockResolvedValue({ data: mockMetadata() });
    resolver = require('../services/oauthEndpointResolver');

    await resolver.initializeDiscovery();

    expect(resolver.getTokenEndpoint()).toBe('https://override.example.com/token');
  });

  // ── Test 16 ───────────────────────────────────────────────────────────────
  test('falls back to PingOne pattern when discovery fails', async () => {
    process.env.OAUTH_DISCOVERY_ENABLED = 'true';
    process.env.OAUTH_ISSUER = 'https://federate.example.com';
    process.env.PINGONE_ENVIRONMENT_ID = 'fallback-env-123';
    process.env.PINGONE_REGION = 'com';
    mockAxios.get.mockRejectedValue(new Error('network error'));
    resolver = require('../services/oauthEndpointResolver');

    await resolver.initializeDiscovery();

    expect(resolver.getTokenEndpoint()).toBe(
      'https://auth.pingone.com/fallback-env-123/as/token'
    );
  });

  // ── Test 17 ───────────────────────────────────────────────────────────────
  test('_resetDiscoveryCache clears cached endpoints', async () => {
    process.env.OAUTH_DISCOVERY_ENABLED = 'true';
    process.env.OAUTH_ISSUER = 'https://federate.example.com';
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.PINGONE_REGION = 'com';
    mockAxios.get.mockResolvedValue({ data: mockMetadata() });
    resolver = require('../services/oauthEndpointResolver');

    await resolver.initializeDiscovery();
    expect(resolver.getTokenEndpoint()).toBe('https://federate.example.com/as/token.oauth2');

    resolver._resetDiscoveryCache();

    expect(resolver.getTokenEndpoint()).toBe('https://auth.pingone.com/test-env-123/as/token');
  });
});
