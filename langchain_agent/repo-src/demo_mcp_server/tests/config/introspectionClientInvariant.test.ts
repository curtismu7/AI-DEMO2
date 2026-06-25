/**
 * Regression: the MCP server's RFC 7662 introspection client MUST be the same
 * client the gateway uses for the downstream RFC 8693 exchange.
 *
 * PingOne binds token introspection to the REQUESTING client: a token (whether
 * client_credentials or RFC 8693 token-exchange) returns active:true ONLY when
 * introspected by the client that requested it. The gateway exchanges as
 * MCP_GW_CLIENT_ID; therefore the MCP server must introspect as MCP_GW_*.
 * Holding a resource grant on the token's audience does NOT confer
 * introspection rights (empirically disproven — REGRESSION_PLAN.md §4
 * 2026-05-18, "Chip 401 Gateway Rejected Token").
 *
 * This locks the resolution precedence in environments.ts:
 *   clientId     = GW_INTROSPECTION_CLIENT_ID || PINGONE_MCP_GATEWAY_CLIENT_ID || MCP_GW_CLIENT_ID || PINGONE_CLIENT_ID
 *   clientSecret = GW_INTROSPECTION_CLIENT_SECRET || PINGONE_MCP_GATEWAY_CLIENT_SECRET || MCP_GW_CLIENT_SECRET || PINGONE_CLIENT_SECRET
 */
import { getEnvironmentConfig, Environment } from '../../src/config/environments';
import { EnvironmentVariables } from '../../src/interfaces/config';

const baseEnv: EnvironmentVariables = {
  PINGONE_BASE_URL: 'https://auth.example.com/env/as',
  PINGONE_INTROSPECTION_ENDPOINT: 'https://auth.example.com/env/as/introspect',
  PINGONE_AUTHORIZATION_ENDPOINT: 'https://auth.example.com/env/as/authorize',
  PINGONE_TOKEN_ENDPOINT: 'https://auth.example.com/env/as/token',
  ENCRYPTION_KEY: 'test-encryption-key-test-encryption-key',
};

describe('MCP introspection client == gateway exchange client invariant', () => {
  const cfg = getEnvironmentConfig(Environment.DEVELOPMENT);

  it('prefers PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET (the gateway exchange client) when present', () => {
    const out = cfg.getConfig({
      ...baseEnv,
      PINGONE_MCP_GATEWAY_CLIENT_ID: 'gw-client-id',
      PINGONE_MCP_GATEWAY_CLIENT_SECRET: 'gw-client-secret',
      // PINGONE_* present but MUST be overridden by PINGONE_MCP_GATEWAY_*
      PINGONE_CLIENT_ID: 'pingone-client-id',
      PINGONE_CLIENT_SECRET: 'pingone-client-secret',
    });
    expect(out.pingone.clientId).toBe('gw-client-id');
    expect(out.pingone.clientSecret).toBe('gw-client-secret');
  });

  it('falls back to PINGONE_CLIENT_ID/SECRET when MCP_GW_* absent (.env-only dev)', () => {
    const out = cfg.getConfig({
      ...baseEnv,
      PINGONE_CLIENT_ID: 'pingone-client-id',
      PINGONE_CLIENT_SECRET: 'pingone-client-secret',
    });
    expect(out.pingone.clientId).toBe('pingone-client-id');
    expect(out.pingone.clientSecret).toBe('pingone-client-secret');
  });
});
