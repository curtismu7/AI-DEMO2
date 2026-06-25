'use strict';
/**
 * OAuth Endpoint Configuration Tests (Phase 169-01)
 *
 * Verifies that:
 * - PingOne URLs are auto-computed from environment_id + region (backward compat)
 * - Custom endpoints override PingOne defaults (Federate, Auth0, Okta, etc.)
 * - OAUTH_* env vars populate configStore and flow through to all services
 * - oauthEndpointResolver priority: explicit config > PingOne pattern > empty
 *
 * No live credentials needed — all tests use env var injection or mocked configStore.
 */

const path = require('path');
// Load .env if present (optional — tests work without it)
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

describe('OAuth Endpoint Configuration', () => {
  let resolver;

  beforeEach(() => {
    // Clear module cache so env var changes take effect
    jest.resetModules();
    // Remove any explicit override env vars before each test
    delete process.env.OAUTH_AUTHORIZATION_ENDPOINT;
    delete process.env.OAUTH_TOKEN_ENDPOINT;
    delete process.env.OAUTH_USERINFO_ENDPOINT;
    delete process.env.OAUTH_JWKS_URI;
    delete process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_DISCOVERY_ENDPOINT;
  });

  afterEach(() => {
    jest.resetModules();
    delete process.env.OAUTH_AUTHORIZATION_ENDPOINT;
    delete process.env.OAUTH_TOKEN_ENDPOINT;
    delete process.env.OAUTH_USERINFO_ENDPOINT;
    delete process.env.OAUTH_JWKS_URI;
    delete process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_DISCOVERY_ENDPOINT;
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_REGION;
  });

  // ── Test 1: PingOne defaults ──────────────────────────────────────────────
  test('should compute PingOne URLs from environment_id + region when no custom endpoints set', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.PINGONE_REGION = 'com';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getAuthorizationEndpoint()).toBe(
      'https://auth.pingone.com/test-env-123/as/authorize'
    );
    expect(resolver.getTokenEndpoint()).toBe(
      'https://auth.pingone.com/test-env-123/as/token'
    );
    expect(resolver.getUserInfoEndpoint()).toBe(
      'https://auth.pingone.com/test-env-123/as/userinfo'
    );
    expect(resolver.getJwksUri()).toBe(
      'https://auth.pingone.com/test-env-123/as/jwks'
    );
    expect(resolver.getIssuer()).toBe(
      'https://auth.pingone.com/test-env-123/as'
    );
  });

  // ── Test 2: EU region ─────────────────────────────────────────────────────
  test('should use eu region when PINGONE_REGION=eu', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'eu-env-456';
    process.env.PINGONE_REGION = 'eu';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getTokenEndpoint()).toBe(
      'https://auth.pingone.eu/eu-env-456/as/token'
    );
  });

  // ── Test 3: Custom authorization endpoint ────────────────────────────────
  test('should use custom auth endpoint when OAUTH_AUTHORIZATION_ENDPOINT set', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.OAUTH_AUTHORIZATION_ENDPOINT = 'https://federate.example.com/as/authorization.oauth2';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getAuthorizationEndpoint()).toBe(
      'https://federate.example.com/as/authorization.oauth2'
    );
    // Other endpoints still fall back to PingOne
    expect(resolver.getTokenEndpoint()).toContain('auth.pingone');
  });

  // ── Test 4: Custom token endpoint ────────────────────────────────────────
  test('should use custom token endpoint when OAUTH_TOKEN_ENDPOINT set', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.OAUTH_TOKEN_ENDPOINT = 'https://federate.example.com/as/token.oauth2';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getTokenEndpoint()).toBe(
      'https://federate.example.com/as/token.oauth2'
    );
  });

  // ── Test 5: Custom JWKS URI ───────────────────────────────────────────────
  test('should use custom JWKS URI when OAUTH_JWKS_URI set', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.OAUTH_JWKS_URI = 'https://auth0.example.auth0.com/.well-known/jwks.json';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getJwksUri()).toBe(
      'https://auth0.example.auth0.com/.well-known/jwks.json'
    );
  });

  // ── Test 6: Custom issuer ─────────────────────────────────────────────────
  test('should use custom issuer when OAUTH_ISSUER set', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.OAUTH_ISSUER = 'https://okta.example.com/oauth2/default';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getIssuer()).toBe('https://okta.example.com/oauth2/default');
  });

  // ── Test 6b: PingOne issuer missing /as is auto-corrected ────────────────
  // Regression guard: a misconfigured OAUTH_ISSUER without the PingOne "/as"
  // suffix made every token fail validation ("jwt issuer invalid"), silently
  // breaking all authenticated requests (and the vertical chips that depend on
  // them). getIssuer() normalizes PingOne issuers so the omission can't recur.
  test('appends /as to a PingOne issuer missing the suffix', () => {
    process.env.OAUTH_ISSUER = 'https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getIssuer()).toBe(
      'https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as'
    );
  });

  test('leaves a correct PingOne issuer (already /as) untouched', () => {
    process.env.OAUTH_ISSUER = 'https://auth.pingone.eu/eu-env-456/as';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getIssuer()).toBe('https://auth.pingone.eu/eu-env-456/as');
  });

  test('does NOT append /as to a non-PingOne issuer', () => {
    process.env.OAUTH_ISSUER = 'https://federate.example.com';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getIssuer()).toBe('https://federate.example.com');
  });

  // ── Test 7: Federate pattern — all 5 endpoints configured ────────────────
  test('should support full Federate endpoint pattern', () => {
    process.env.OAUTH_AUTHORIZATION_ENDPOINT = 'https://federate.example.com/as/authorization.oauth2';
    process.env.OAUTH_TOKEN_ENDPOINT         = 'https://federate.example.com/as/token.oauth2';
    process.env.OAUTH_USERINFO_ENDPOINT      = 'https://federate.example.com/idp/userinfo.openid';
    process.env.OAUTH_JWKS_URI               = 'https://federate.example.com/pf/JWKS';
    process.env.OAUTH_ISSUER                 = 'https://federate.example.com';
    resolver = require('../services/oauthEndpointResolver');

    const endpoints = resolver.getOAuthEndpoints();
    expect(endpoints.authorization_endpoint).toBe('https://federate.example.com/as/authorization.oauth2');
    expect(endpoints.token_endpoint).toBe('https://federate.example.com/as/token.oauth2');
    expect(endpoints.userinfo_endpoint).toBe('https://federate.example.com/idp/userinfo.openid');
    expect(endpoints.jwks_uri).toBe('https://federate.example.com/pf/JWKS');
    expect(endpoints.issuer).toBe('https://federate.example.com');
  });

  // ── Test 8: Auth0 pattern ────────────────────────────────────────────────
  test('should support Auth0 endpoint pattern', () => {
    process.env.OAUTH_AUTHORIZATION_ENDPOINT = 'https://example.auth0.com/authorize';
    process.env.OAUTH_TOKEN_ENDPOINT         = 'https://example.auth0.com/oauth/token';
    process.env.OAUTH_USERINFO_ENDPOINT      = 'https://example.auth0.com/userinfo';
    process.env.OAUTH_JWKS_URI               = 'https://example.auth0.com/.well-known/jwks.json';
    process.env.OAUTH_ISSUER                 = 'https://example.auth0.com/';
    resolver = require('../services/oauthEndpointResolver');

    const endpoints = resolver.getOAuthEndpoints();
    expect(endpoints.token_endpoint).toBe('https://example.auth0.com/oauth/token');
    expect(endpoints.issuer).toBe('https://example.auth0.com/');
  });

  // ── Test 9: Partial config — only token endpoint overridden ──────────────
  test('should support partial config with mixed PingOne and custom endpoints', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.PINGONE_REGION = 'com';
    process.env.OAUTH_TOKEN_ENDPOINT = 'https://custom-idp.example.com/token';
    resolver = require('../services/oauthEndpointResolver');

    // Token uses custom
    expect(resolver.getTokenEndpoint()).toBe('https://custom-idp.example.com/token');
    // Auth still falls back to PingOne
    expect(resolver.getAuthorizationEndpoint()).toBe(
      'https://auth.pingone.com/test-env-123/as/authorize'
    );
  });

  // ── Test 10: Explicit override wins over builtin defaults ────────────────
  test('explicit OAUTH_TOKEN_ENDPOINT always overrides any PingOne default', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'default-env';
    process.env.OAUTH_TOKEN_ENDPOINT = 'https://custom.example.com/token';
    resolver = require('../services/oauthEndpointResolver');

    // Custom must win regardless of PingOne env being set
    expect(resolver.getTokenEndpoint()).toBe('https://custom.example.com/token');
    // Auth falls back to PingOne (no override for it)
    expect(resolver.getAuthorizationEndpoint()).toContain('default-env');
  });

  // ── Test 11: getOAuthEndpoints returns all 6 fields ──────────────────────
  test('getOAuthEndpoints() returns an object with all 6 endpoint fields', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    resolver = require('../services/oauthEndpointResolver');

    const endpoints = resolver.getOAuthEndpoints();
    expect(endpoints).toHaveProperty('authorization_endpoint');
    expect(endpoints).toHaveProperty('token_endpoint');
    expect(endpoints).toHaveProperty('userinfo_endpoint');
    expect(endpoints).toHaveProperty('jwks_uri');
    expect(endpoints).toHaveProperty('issuer');
    expect(endpoints).toHaveProperty('discovery_endpoint');
  });

  // ── Test 12: Discovery endpoint ──────────────────────────────────────────
  test('should compute PingOne discovery endpoint from environment_id', () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-123';
    process.env.PINGONE_REGION = 'com';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getDiscoveryEndpoint()).toBe(
      'https://auth.pingone.com/test-env-123/as/.well-known/openid-configuration'
    );
  });

  // ── Test 13: Custom discovery endpoint override ───────────────────────────
  test('should use custom discovery endpoint when OAUTH_DISCOVERY_ENDPOINT set', () => {
    process.env.OAUTH_DISCOVERY_ENDPOINT = 'https://federate.example.com/.well-known/openid-configuration';
    resolver = require('../services/oauthEndpointResolver');

    expect(resolver.getDiscoveryEndpoint()).toBe(
      'https://federate.example.com/.well-known/openid-configuration'
    );
  });
});
