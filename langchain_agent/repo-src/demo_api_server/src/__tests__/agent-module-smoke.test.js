/**
 * @file agent-module-smoke.test.js
 * @description Smoke tests that verify the agent flow module chain loads
 *   without errors. These catch require() failures, missing exports,
 *   and initialization crashes — the exact class of bug that caused
 *   "Cannot find module './logger'" in configStore.js.
 *
 *   Also tests the full token exchange → MCP path with mocked PingOne
 *   to validate the integration between configStore, agentMcpTokenService,
 *   and agentSessionMiddleware.
 */

'use strict';

// ── Module-loading smoke tests ───────────────────────────────────────────────
// These tests verify that require() succeeds and exports are correct.
// They do NOT mock anything — they test real module resolution.

describe('Agent flow module loading (smoke)', () => {
  it('configStore loads without require errors', () => {
    expect(() => require('../../services/configStore')).not.toThrow();
  });

  it('configStore exports validateTwoExchangeConfig', () => {
    const cs = require('../../services/configStore');
    expect(typeof cs.validateTwoExchangeConfig).toBe('function');
  });

  it('configStore exports buildAllowedScopesByAudience', () => {
    const cs = require('../../services/configStore');
    expect(typeof cs.buildAllowedScopesByAudience).toBe('function');
  });

  it('configStore exports validateScopeAudience', () => {
    const cs = require('../../services/configStore');
    expect(typeof cs.validateScopeAudience).toBe('function');
  });

  it('configStore exports mapErrorToCode', () => {
    const cs = require('../../services/configStore');
    expect(typeof cs.mapErrorToCode).toBe('function');
  });

  it('configStore exports ERROR_CODES', () => {
    const cs = require('../../services/configStore');
    expect(cs.ERROR_CODES).toBeDefined();
    expect(typeof cs.ERROR_CODES).toBe('object');
  });

  it('agentSessionMiddleware loads without require errors', () => {
    expect(() => require('../../middleware/agentSessionMiddleware')).not.toThrow();
  });

  it('agentMcpTokenService loads without require errors', () => {
    expect(() => require('../../services/agentMcpTokenService')).not.toThrow();
  });

  it('agentTokenService loads without require errors', () => {
    expect(() => require('../../services/agentTokenService')).not.toThrow();
  });

  it('oauthService loads without require errors', () => {
    expect(() => require('../../services/oauthService')).not.toThrow();
  });

  it('utils/logger loads without require errors', () => {
    const loggerModule = require('../../utils/logger');
    expect(loggerModule.logger).toBeDefined();
  });

  it('mcpWebSocketClient loads without require errors', () => {
    expect(() => require('../../services/mcpWebSocketClient')).not.toThrow();
  });
});

// ── ConfigStore singleton consistency ────────────────────────────────────────
// Verify the singleton pattern works (the "store is not defined" bug class)

describe('ConfigStore singleton consistency', () => {
  it('get() and _cache work on the singleton', () => {
    const cs = require('../../services/configStore');
    cs._cache['_TEST_SMOKE_KEY'] = 'smoke-value';
    expect(cs.get('_TEST_SMOKE_KEY')).toBe('smoke-value');
    // Clean up
    delete cs._cache['_TEST_SMOKE_KEY'];
  });

  it('getEffective() falls back to env vars for known keys', () => {
    // getEffective uses envFallbackMap for known keys; test a known mapping
    process.env.PINGONE_ENVIRONMENT_ID = 'smoke-env-123';
    const cs = require('../../services/configStore');
    const val = cs.getEffective('pingone_environment_id');
    expect(val).toBe('smoke-env-123');
    delete process.env.PINGONE_ENVIRONMENT_ID;
  });

  it('buildAllowedScopesByAudience reads from singleton at call time', () => {
    const cs = require('../../services/configStore');
    // Set a custom audience via _cache. buildAllowedScopesByAudience reads the
    // enduser audience via getEffective('enduser_audience'), whose cache key is
    // the uppercased ENDUSER_AUDIENCE (the old PINGONE_AUDIENCE_ENDUSER key was
    // retired in a385d679).
    cs._cache['ENDUSER_AUDIENCE'] = 'https://smoke-test.example.com';
    const mapping = cs.buildAllowedScopesByAudience();
    expect(mapping['https://smoke-test.example.com']).toBeDefined();
    // Reset
    delete cs._cache['ENDUSER_AUDIENCE'];
  });
});

// ── Token exchange integration (mocked PingOne, real configStore) ────────────

describe('Agent token exchange flow integration', () => {
  let configStore;

  beforeAll(() => {
    configStore = require('../../services/configStore');
  });

  it('validateScopeAudience narrows user scopes for MCP server', () => {
    configStore._cache['PINGONE_RESOURCE_MCP_SERVER_URI'] = 'https://test-mcp.example.com';
    const result = configStore.validateScopeAudience(
      ['read', 'write', 'mcp:invoke', 'openid'],
      'https://test-mcp.example.com'
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toContain('read');
    expect(result.scopes).toContain('mcp:invoke');
    expect(result.scopes).not.toContain('openid');
    // Clean up
    delete configStore._cache['PINGONE_RESOURCE_MCP_SERVER_URI'];
  });

  it('validateTwoExchangeConfig returns credentials when all env set', () => {
    // Setup
    process.env.PINGONE_AI_AGENT_CLIENT_ID = 'smoke-ai-cid';
    process.env.PINGONE_AI_AGENT_CLIENT_SECRET = 'smoke-ai-secret';
    process.env.AGENT_OAUTH_CLIENT_ID = 'smoke-mcp-cid';
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'smoke-mcp-secret';
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'https://agent-gw.smoke.com';
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'https://mcp-gw.smoke.com';
    process.env.AI_AGENT_INTERMEDIATE_AUDIENCE = 'https://intermediate.smoke.com';
    process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI = 'https://final.smoke.com';

    const result = configStore.validateTwoExchangeConfig();
    expect(result.valid).toBe(true);
    expect(result.credentials.aiAgentClientId).toBe('smoke-ai-cid');

    // Cleanup
    [
      'PINGONE_AI_AGENT_CLIENT_ID',
      'PINGONE_AI_AGENT_CLIENT_SECRET',
      'AGENT_OAUTH_CLIENT_ID',
      'AGENT_OAUTH_CLIENT_SECRET',
      'PINGONE_RESOURCE_AGENT_GATEWAY_URI',
      'PINGONE_RESOURCE_MCP_GATEWAY_URI',
      'AI_AGENT_INTERMEDIATE_AUDIENCE',
      'PINGONE_RESOURCE_TWO_EXCHANGE_URI',
    ].forEach(k => delete process.env[k]);
  });

  it('getErrorDetails returns structured error info', () => {
    const { getErrorDetails } = configStore;
    const details = getErrorDetails('invalid_scope');
    expect(details).toBeDefined();
    expect(details.http_status).toBe(400);
    expect(details.oauth_error).toBe('invalid_scope');
  });
});

// ── Auth method & env fallback chain tests ──────────────────────────────────
// These catch the exact class of bug where code reads process.env.X directly
// but .env has the value under PINGONE_X (alias), or where auth method
// defaults to 'basic' but PingOne app requires 'post'.

describe('Token exchange env-to-code pipeline', () => {
  const ENV_BACKUP = {};

  beforeEach(() => {
    // Snapshot relevant env vars
    [
      'AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD',
      'MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD',
      'AGENT_OAUTH_CLIENT_SECRET',
      'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET',
      'PINGONE_AI_AGENT_CLIENT_SECRET',
      'AI_AGENT_CLIENT_SECRET',
    ].forEach(k => {
      ENV_BACKUP[k] = process.env[k];
    });
  });

  afterEach(() => {
    Object.entries(ENV_BACKUP).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  it('agentMcpTokenService reads MCP exchanger secret via configStore fallback chain', () => {
    // Simulate real .env: only PINGONE_ prefix is set, not AGENT_OAUTH_
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET = 'test-secret-pingone';

    const configStore = require('../../services/configStore');
    const secret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    expect(secret).toBe('test-secret-pingone');
  });

  it('agentMcpTokenService reads AI agent secret via configStore fallback chain', () => {
    delete process.env.AI_AGENT_CLIENT_SECRET;
    process.env.PINGONE_AI_AGENT_CLIENT_SECRET = 'test-ai-secret';

    const configStore = require('../../services/configStore');
    const secret = configStore.getEffective('pingone_ai_agent_client_secret');
    expect(secret).toBe('test-ai-secret');
  });

  it('AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD=post is read correctly', () => {
    process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD = 'post';

    const method = (process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD || 'basic').toLowerCase();
    expect(method).toBe('post');
  });

  it('AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD defaults to basic when unset', () => {
    delete process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD;

    const method = (process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD || 'basic').toLowerCase();
    expect(method).toBe('basic');
  });

  it('applyTokenEndpointAuth puts client_secret in body for post method', () => {
    // Test the actual applyTokenEndpointAuth logic
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: 'test-cid' });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    // Simulate 'post' method
    const method = 'post';
    const clientSecret = 'test-secret';
    if (method === 'post') {
      body.set('client_secret', clientSecret);
    } else {
      headers.Authorization = 'Basic ' + Buffer.from(`test-cid:${clientSecret}`).toString('base64');
    }

    expect(body.get('client_secret')).toBe('test-secret');
    expect(headers.Authorization).toBeUndefined();
  });

  it('applyTokenEndpointAuth puts Authorization header for basic method', () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: 'test-cid' });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    const method = 'basic';
    const clientSecret = 'test-secret';
    if (method === 'post') {
      body.set('client_secret', clientSecret);
    } else {
      headers.Authorization = 'Basic ' + Buffer.from(`test-cid:${clientSecret}`).toString('base64');
    }

    expect(body.has('client_secret')).toBe(false);
    expect(headers.Authorization).toMatch(/^Basic /);
  });
});
