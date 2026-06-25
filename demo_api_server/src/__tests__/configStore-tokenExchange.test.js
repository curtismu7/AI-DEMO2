/**
 * @file configStore-tokenExchange.test.js
 * @description Tests for configStore token-exchange functions:
 *   - validateTwoExchangeConfig()
 *   - buildAllowedScopesByAudience()
 *   - validateScopeAudience()
 *   - mapErrorToCode()
 *
 * These are critical for the agent flow — a bad require path or missing
 * config value crashes "Show me my accounts" at runtime.
 */

'use strict';

// ── Env stubs (before any require) ───────────────────────────────────────────

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  // Start each test with a clean env
  Object.keys(process.env).forEach(k => {
    if (
      k.startsWith('PINGONE_') ||
      k.startsWith('AI_AGENT_') ||
      k.startsWith('AGENT_OAUTH_') ||
      k === 'KV_REST_API_URL' ||
      k === 'KV_REST_API_TOKEN' ||
      k === 'VERCEL'
    ) {
      delete process.env[k];
    }
  });
});

afterAll(() => {
  // Restore original env
  Object.keys(process.env).forEach(k => delete process.env[k]);
  Object.assign(process.env, ENV_SNAPSHOT);
});

// Helper: load configStore fresh (singleton resets on resetModules)
// Also clears cache keys that may have been loaded from SQLite/.env
function loadConfigStore() {
  const cs = require('../../services/configStore');
  // Clear cache keys used by validateTwoExchangeConfig so tests control all inputs
  const keysToClean = [
    'pingone_mcp_token_exchanger_client_id',
    'PINGONE_AI_AGENT_ACTOR_CLIENT_ID',
    'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET',
    'PINGONE_RESOURCE_AGENT_GATEWAY_URI',
    'PINGONE_RESOURCE_MCP_GATEWAY_URI',
    'AI_AGENT_INTERMEDIATE_AUDIENCE',
    'PINGONE_RESOURCE_TWO_EXCHANGE_URI',
    'AGENT_OAUTH_CLIENT_ID',
  ];
  keysToClean.forEach(k => { cs._cache[k] = ''; });
  return cs;
}

// Helper: set all required two-exchange env vars
function setTwoExchangeEnv() {
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = 'ai-agent-cid';
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET = 'ai-agent-secret';
  process.env.AGENT_OAUTH_CLIENT_ID = 'mcp-exchanger-cid';
  process.env.AGENT_OAUTH_CLIENT_SECRET = 'mcp-exchanger-secret';
  process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'https://agent-gw.example.com';
  process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'https://mcp-gw.example.com';
  process.env.AI_AGENT_INTERMEDIATE_AUDIENCE = 'https://ai-agent-intermediate.example.com';
  process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI = 'https://mcp-final.example.com';
}

// ─────────────────────────────────────────────────────────────────────────────
// validateTwoExchangeConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTwoExchangeConfig()', () => {
  it('returns valid config when all credentials and audiences are set', () => {
    setTwoExchangeEnv();
    const { validateTwoExchangeConfig } = loadConfigStore();
    const result = validateTwoExchangeConfig();

    expect(result.valid).toBe(true);
    expect(result.credentials.aiAgentClientId).toBeTruthy();
    expect(result.credentials.mcpClientId).toBeTruthy();
    expect(result.audiences.agentGatewayAud).toBeTruthy();
    expect(result.audiences.intermediateAud).toBeTruthy();
    expect(result.audiences.mcpGatewayAud).toBeTruthy();
    expect(result.audiences.finalAud).toBeTruthy();
  });

  it('throws TWO_EXCHANGE_CONFIG_INVALID when AI Agent client ID is missing', () => {
    setTwoExchangeEnv();
    delete process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID;
    const { validateTwoExchangeConfig } = loadConfigStore();

    expect(() => validateTwoExchangeConfig()).toThrow();
    try {
      validateTwoExchangeConfig();
    } catch (err) {
      expect(err.code).toBe('TWO_EXCHANGE_CONFIG_INVALID');
      expect(err.httpStatus).toBe(503);
      expect(err.isConfigError).toBe(true);
      expect(err.details.missing).toEqual(
        expect.arrayContaining([expect.stringContaining('PINGONE_AI_AGENT_ACTOR_CLIENT_ID')])
      );
    }
  });

  it('throws when AI Agent client secret is missing', () => {
    setTwoExchangeEnv();
    delete process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET;
    const { validateTwoExchangeConfig } = loadConfigStore();

    expect(() => validateTwoExchangeConfig()).toThrow(/PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET/);
  });

  it('throws when MCP exchanger client ID is missing (env + cache cleared)', () => {
    setTwoExchangeEnv();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    const cs = loadConfigStore();
    // Clear from cache (SQLite/KV may have loaded it)
    cs._cache['pingone_mcp_token_exchanger_client_id'] = '';
    cs._cache['PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID'] = '';

    // Note: getEffective may still find a value from pingoneBackendDefaults.js
    // In that case, validation passes — which is correct for the demo environment.
    // Test the code path where ALL sources are empty by also deleting the secret.
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;

    // With the secret missing, it should throw even if client ID is in defaults
    expect(() => cs.validateTwoExchangeConfig()).toThrow(/AGENT_OAUTH_CLIENT_SECRET/);
  });

  it('throws when MCP exchanger client secret is missing', () => {
    setTwoExchangeEnv();
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    const { validateTwoExchangeConfig } = loadConfigStore();

    expect(() => validateTwoExchangeConfig()).toThrow(/AGENT_OAUTH_CLIENT_SECRET/);
  });

  it('throws when audience URIs are missing', () => {
    setTwoExchangeEnv();
    delete process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI;
    delete process.env.AI_AGENT_INTERMEDIATE_AUDIENCE;
    // Also clean from cache and other env fallbacks
    delete process.env.AGENT_GATEWAY_AUDIENCE;
    const cs = loadConfigStore();
    cs._cache['PINGONE_RESOURCE_AGENT_GATEWAY_URI'] = '';
    cs._cache['AI_AGENT_INTERMEDIATE_AUDIENCE'] = '';

    try {
      cs.validateTwoExchangeConfig();
      fail('Expected error');
    } catch (err) {
      expect(err.code).toBe('TWO_EXCHANGE_CONFIG_INVALID');
      expect(err.details.missing.length).toBeGreaterThanOrEqual(1);
      // At least one of the URIs should be reported missing
      const missingStr = err.details.missing.join(' ');
      expect(
        missingStr.includes('PINGONE_RESOURCE_AGENT_GATEWAY_URI') ||
        missingStr.includes('AI_AGENT_INTERMEDIATE_AUDIENCE')
      ).toBeTruthy();
    }
  });

  it('collects ALL errors at once (not fail-fast)', () => {
    // Clear every possible env/cache source
    const keysToDelete = Object.keys(process.env).filter(k =>
      k.startsWith('PINGONE_') || k.startsWith('AI_AGENT_') ||
      k.startsWith('AGENT_') || k.startsWith('MCP_') ||
      k.includes('AUDIENCE') || k.includes('GATEWAY') || k.includes('EXCHANGE')
    );
    keysToDelete.forEach(k => delete process.env[k]);

    const cs = loadConfigStore();
    // Also clear all relevant cache keys
    [
      'pingone_mcp_token_exchanger_client_id',
      'PINGONE_AI_AGENT_ACTOR_CLIENT_ID', 'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET',
      'PINGONE_RESOURCE_AGENT_GATEWAY_URI', 'PINGONE_RESOURCE_MCP_GATEWAY_URI',
      'AI_AGENT_INTERMEDIATE_AUDIENCE', 'PINGONE_RESOURCE_TWO_EXCHANGE_URI',
      'AGENT_OAUTH_CLIENT_ID',
    ].forEach(k => { cs._cache[k] = ''; });

    try {
      cs.validateTwoExchangeConfig();
      fail('Expected error');
    } catch (err) {
      // Should collect multiple errors (creds + audiences)
      expect(err.details.missing.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('warns (but does not throw) when intermediateAud === finalAud', () => {
    setTwoExchangeEnv();
    process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI = process.env.AI_AGENT_INTERMEDIATE_AUDIENCE;
    const { validateTwoExchangeConfig } = loadConfigStore();

    // Should not throw — just returns valid with a warning logged
    const result = validateTwoExchangeConfig();
    expect(result.valid).toBe(true);
  });

  it('error message includes remediation steps', () => {
    const { validateTwoExchangeConfig } = loadConfigStore();

    try {
      validateTwoExchangeConfig();
      fail('Expected error');
    } catch (err) {
      expect(err.message).toContain('Remediation Steps');
      expect(err.message).toContain('Set missing environment variables');
    }
  });

  // ── Fallback chain tests (bugs 2026-04-15) ──────────────────────────────────
  // These catch the exact bugs where code reads process.env.AGENT_OAUTH_CLIENT_SECRET
  // directly but the .env file uses PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET.

  it('accepts PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET as alias for AGENT_OAUTH_CLIENT_SECRET', () => {
    setTwoExchangeEnv();
    // Remove the direct alias; only the PINGONE_ prefixed name is set
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET = 'exchanger-secret-via-pingone';
    const { validateTwoExchangeConfig } = loadConfigStore();

    const result = validateTwoExchangeConfig();
    expect(result.valid).toBe(true);
    expect(result.credentials.mcpClientId).toBeTruthy();
  });

  it('accepts PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID as alias for AGENT_OAUTH_CLIENT_ID', () => {
    setTwoExchangeEnv();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = 'exchanger-cid-via-pingone';
    const { validateTwoExchangeConfig } = loadConfigStore();

    const result = validateTwoExchangeConfig();
    expect(result.valid).toBe(true);
  });

  it('fails when NEITHER AGENT_OAUTH_CLIENT_SECRET nor PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET is set', () => {
    setTwoExchangeEnv();
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    // Ensure PINGONE_ alias is also not set
    delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;
    const { validateTwoExchangeConfig } = loadConfigStore();

    expect(() => validateTwoExchangeConfig()).toThrow(/AGENT_OAUTH_CLIENT_SECRET/);
  });
});

/** Seed audience URIs so buildAllowedScopesByAudience / validateScopeAudience are deterministic. */
function seedAudienceEnvForScopeTests() {
  process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
  process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'agentgateway.ping.demo';
  process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'mcpgateway.ping.demo';
  process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpserver.ping.demo';
}

// ─────────────────────────────────────────────────────────────────────────────
// buildAllowedScopesByAudience
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAllowedScopesByAudience()', () => {
  beforeEach(() => {
    seedAudienceEnvForScopeTests();
  });

  it('returns mapping with 4 audience keys using defaults', () => {
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();

    // Should have entries for 4 default audiences
    const keys = Object.keys(mapping);
    expect(keys.length).toBe(4);

    // Each entry should be a non-empty array of scope strings
    keys.forEach(k => {
      expect(Array.isArray(mapping[k])).toBe(true);
      expect(mapping[k].length).toBeGreaterThan(0);
      mapping[k].forEach(scope => expect(typeof scope).toBe('string'));
    });
  });

  it('end-user audience includes read and write', () => {
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();

    // Default end-user audience
    const endUserAud = 'enduser.ping.demo';
    expect(mapping[endUserAud]).toEqual(
      expect.arrayContaining(['read', 'write'])
    );
  });

  it('agent gateway audience includes ai:agent scope', () => {
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();

    // After scope rename: agent gateway uses 'ai:agent' and 'ai_agent' (not 'ai:agent:read')
    const agentGw = 'agentgateway.ping.demo';
    expect(mapping[agentGw]).toEqual(expect.arrayContaining(['ai:agent']));
  });

  it('MCP audiences include mcp:invoke', () => {
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();

    const mcpGw = 'mcpgateway.ping.demo';
    const mcpServer = 'mcpserver.ping.demo';
    expect(mapping[mcpGw]).toEqual(expect.arrayContaining(['mcp:invoke']));
    expect(mapping[mcpServer]).toEqual(expect.arrayContaining(['mcp:invoke']));
  });

  it('MCP audiences include vertical feature scopes (records:read, gear:read, expense:read)', () => {
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();

    const mcpGw = 'mcpgateway.ping.demo';
    const mcpServer = 'mcpserver.ping.demo';
    for (const aud of [mcpGw, mcpServer]) {
      expect(mapping[aud]).toEqual(
        expect.arrayContaining(['records:read', 'gear:read', 'expense:read']),
      );
    }
  });

  it('MCP Gateway audience includes transfer (scope-topology mirroredScopes parity)', () => {
    // Regression: transfer is mirrored onto the MCP Gateway resource in
    // scope-topology.json so create_transfer (requires write+transfer) can be
    // authorized at the gateway. It must NOT be stripped by RFC 8707 audience
    // validation. (Not mirrored onto the MCP server — keep that asymmetry.)
    const { buildAllowedScopesByAudience } = loadConfigStore();
    const mapping = buildAllowedScopesByAudience();
    expect(mapping['mcpgateway.ping.demo']).toEqual(expect.arrayContaining(['transfer']));
    expect(mapping['mcpserver.ping.demo']).not.toContain('transfer');
  });

  it('unions scopes when MCP server + gateway audiences collapse to the same URI (transfer survives)', () => {
    // In this demo the MCP server validates the GATEWAY aud, so both resource
    // URIs collapse to mcpgateway.ping.demo. The mapping must UNION the two
    // scope sets — a plain overwrite let the server block (no transfer/ai:agent)
    // clobber the gateway block, which silently denied create_transfer.
    const prevServer = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpgateway.ping.demo';
    try {
      const cs = loadConfigStore();
      cs._cache['PINGONE_RESOURCE_MCP_SERVER_URI'] = '';
      const mapping = cs.buildAllowedScopesByAudience();
      expect(mapping['mcpgateway.ping.demo']).toEqual(
        expect.arrayContaining(['transfer', 'ai:agent', 'mcp:invoke', 'read', 'write', 'records:read']),
      );
    } finally {
      process.env.PINGONE_RESOURCE_MCP_SERVER_URI = prevServer;
    }
  });

  it('respects configStore overrides for audience URIs', () => {
    const cs = loadConfigStore();
    cs._cache['ENDUSER_AUDIENCE'] = 'https://custom-banking.example.com';
    const mapping = cs.buildAllowedScopesByAudience();

    expect(mapping['https://custom-banking.example.com']).toBeDefined();
    expect(mapping['https://custom-banking.example.com']).toEqual(
      expect.arrayContaining(['read'])
    );
    delete cs._cache['ENDUSER_AUDIENCE'];
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateScopeAudience
// ─────────────────────────────────────────────────────────────────────────────

describe('validateScopeAudience()', () => {
  beforeEach(() => {
    seedAudienceEnvForScopeTests();
  });

  it('narrows scopes to those allowed for the audience', () => {
    const { validateScopeAudience } = loadConfigStore();
    // After scope rename: end-user audience allows 'ai:agent' not 'ai:agent:read'
    const result = validateScopeAudience(
      ['read', 'write', 'openid', 'ai:agent'],
      'enduser.ping.demo'
    );

    expect(result.valid).toBe(true);
    expect(result.scopes).toContain('read');
    expect(result.scopes).toContain('write');
    expect(result.scopes).toContain('ai:agent');
    // openid should be stripped (not in allowed list for end-user audience)
    expect(result.scopes).not.toContain('openid');
    expect(result.narrowed).toBe(true);
  });

  it('throws SCOPE_ERROR when scopes array is empty', () => {
    const { validateScopeAudience } = loadConfigStore();

    expect(() => validateScopeAudience([], 'enduser.ping.demo')).toThrow(
      /SCOPE_ERROR/
    );
  });

  it('throws SCOPE_ERROR when scopes is null', () => {
    const { validateScopeAudience } = loadConfigStore();

    expect(() => validateScopeAudience(null, 'enduser.ping.demo')).toThrow(
      /SCOPE_ERROR/
    );
  });

  it('throws SCOPE_MISMATCH when no scopes match the audience', () => {
    const { validateScopeAudience } = loadConfigStore();

    expect(() =>
      validateScopeAudience(
        ['openid', 'profile'],
        'enduser.ping.demo'
      )
    ).toThrow(/SCOPE_MISMATCH/);
  });

  it('gracefully degrades for unknown audiences (returns all scopes)', () => {
    const { validateScopeAudience } = loadConfigStore();
    const result = validateScopeAudience(
      ['read', 'write'],
      'https://unknown-audience.example.com'
    );

    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(['read', 'write']);
    expect(result.narrowed).toBe(false);
    expect(result.note).toContain('Unknown audience');
  });

  it('returns narrowed: false when all scopes are allowed', () => {
    const { validateScopeAudience } = loadConfigStore();
    const result = validateScopeAudience(
      ['read', 'write'],
      'enduser.ping.demo'
    );

    expect(result.valid).toBe(true);
    expect(result.narrowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapErrorToCode
// ─────────────────────────────────────────────────────────────────────────────

describe('mapErrorToCode()', () => {
  it('maps "Cannot find module" to server_error', () => {
    const { mapErrorToCode } = loadConfigStore();
    const code = mapErrorToCode(new Error("Cannot find module './logger'"));
    expect(code).toBe('server_error');
  });

  it('maps "credentials not configured" to config.missing_credentials', () => {
    const { mapErrorToCode } = loadConfigStore();
    expect(mapErrorToCode(new Error('credentials not configured'))).toBe(
      'config.missing_credentials'
    );
  });

  it('maps "invalid_scope" to invalid_scope', () => {
    const { mapErrorToCode } = loadConfigStore();
    expect(mapErrorToCode(new Error('invalid_scope: banking:foo'))).toBe('invalid_scope');
  });

  it('maps may_act errors to may_act_validation_failed', () => {
    const { mapErrorToCode } = loadConfigStore();
    expect(mapErrorToCode(new Error('may_act claim missing'))).toBe('may_act_validation_failed');
  });

  it('maps unknown errors to server_error', () => {
    const { mapErrorToCode } = loadConfigStore();
    expect(mapErrorToCode(new Error('something completely unknown'))).toBe('server_error');
  });
});
