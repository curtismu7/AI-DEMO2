'use strict';

// envFallbackVars derives the Privilege gateway OIDC env from process.env so the
// Settings panel shows real config when pingone.env (bind-mounted, gitignored) is
// absent. Only keys that resolve to a value are returned.
describe('privilegeMcpClient envFallbackVars', () => {
  const KEYS = [
    'PRIVILEGE_MCPGW_URL', 'PRIVILEGE_SSO_CLIENT_ID', 'PINGONE_MCP_GATEWAY_CLIENT_ID',
    'PRIVILEGE_SSO_CLIENT_SECRET', 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
    'PRIVILEGE_SSO_ENV_ID', 'PINGONE_ENVIRONMENT_ID',
  ];
  const saved = {};
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; for (const k of KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  function fresh() {
    jest.resetModules();
    return require('../../routes/privilegeMcpClient').__test.envFallbackVars;
  }

  it('derives server/client/URLs from the PRIVILEGE_* env', () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://gw.example/mcp';
    process.env.PRIVILEGE_SSO_CLIENT_ID = 'sso-client';
    process.env.PRIVILEGE_SSO_CLIENT_SECRET = 'sso-secret';
    process.env.PRIVILEGE_SSO_ENV_ID = 'env-123';
    expect(fresh()()).toEqual({
      SERVER_URL: 'https://gw.example/mcp',
      OIDC_CLIENT_ID: 'sso-client',
      OIDC_CLIENT_SECRET: 'sso-secret',
      OIDC_AUTH_URL: 'https://auth.pingone.com/env-123/as/authorize',
      OIDC_TOKEN_URL: 'https://auth.pingone.com/env-123/as/token',
      OIDC_USER_URL: 'https://auth.pingone.com/env-123/as/userinfo',
      OIDC_SCOPES: 'openid profile email',
    });
  });

  it('falls back to the gateway client + banking env id, and omits keys with no source', () => {
    process.env.PINGONE_MCP_GATEWAY_CLIENT_ID = 'gw-client';
    process.env.PINGONE_ENVIRONMENT_ID = 'bank-env';
    const out = fresh()();
    expect(out.OIDC_CLIENT_ID).toBe('gw-client');
    expect(out.OIDC_AUTH_URL).toBe('https://auth.pingone.com/bank-env/as/authorize');
    // No SERVER_URL / secret configured -> those keys are absent (stay editable).
    expect(out).not.toHaveProperty('SERVER_URL');
    expect(out).not.toHaveProperty('OIDC_CLIENT_SECRET');
    // OIDC_SCOPES always has a default.
    expect(out.OIDC_SCOPES).toBe('openid profile email');
  });

  it('omits the OIDC URLs entirely when no env id is set', () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://gw.example/mcp';
    const out = fresh()();
    expect(out).not.toHaveProperty('OIDC_AUTH_URL');
    expect(out.SERVER_URL).toBe('https://gw.example/mcp');
  });
});
