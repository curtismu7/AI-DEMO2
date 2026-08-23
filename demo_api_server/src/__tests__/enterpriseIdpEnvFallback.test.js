'use strict';

/**
 * Native ID-JAG is configured by ENV in docker-compose, on both sides:
 *
 *   oauth-mcp  reads process.env directly (OAuthRouter.nativeIdJagEnabled)
 *   BFF        reads configStore, which must therefore RESOLVE the same env
 *              vars — otherwise the two halves disagree and the BFF mints an
 *              assertion the MCP authorization server refuses.
 *
 * Asserted behaviourally: setting the env var must change what getEffective
 * returns. Checking a map entry existed would pass even if the lookup were
 * wired to the wrong key.
 */

const ORIG = { ...process.env };

function freshConfigStore() {
  jest.resetModules();
  return require('../../services/configStore');
}

afterEach(() => {
  process.env = { ...ORIG };
  jest.resetModules();
});

describe('enterprise IdP env fallback', () => {
  test.each([
    ['enterprise_idp_issuer', 'ENTERPRISE_IDP_ISSUER', 'https://idp.ping.demo'],
    ['enterprise_idp_jwks_url', 'ENTERPRISE_IDP_JWKS_URL', 'https://demo-api-server:3001/api/enterprise-idp/jwks'],
    ['enterprise_mcp_as_token_url', 'ENTERPRISE_MCP_AS_TOKEN_URL', 'https://mcp-server:8080/token'],
  ])('%s resolves from %s', (key, envVar, value) => {
    process.env[envVar] = value;
    const cs = freshConfigStore();
    expect(cs.getEffective(key)).toBe(value);
  });

  test('each key still defaults empty when its env var is unset', () => {
    delete process.env.ENTERPRISE_IDP_ISSUER;
    delete process.env.ENTERPRISE_IDP_JWKS_URL;
    delete process.env.ENTERPRISE_MCP_AS_TOKEN_URL;
    const cs = freshConfigStore();
    expect(cs.getEffective('enterprise_idp_issuer')).toBe('');
    expect(cs.getEffective('enterprise_idp_jwks_url')).toBe('');
    expect(cs.getEffective('enterprise_mcp_as_token_url')).toBe('');
  });

  test('native mode needs BOTH halves — issuer alone does not arm it', () => {
    process.env.ENTERPRISE_IDP_ISSUER = 'https://idp.ping.demo';
    delete process.env.ENTERPRISE_IDP_JWKS_URL;
    jest.resetModules();
    const idJag = require('../../services/idJagService');
    expect(idJag.isNativeIdJagEnabled()).toBe(false);
  });

  test('both env vars set arms native mode without any configStore write', () => {
    process.env.ENTERPRISE_IDP_ISSUER = 'https://idp.ping.demo';
    process.env.ENTERPRISE_IDP_JWKS_URL = 'https://demo-api-server:3001/api/enterprise-idp/jwks';
    jest.resetModules();
    const idJag = require('../../services/idJagService');
    expect(idJag.isNativeIdJagEnabled()).toBe(true);
  });
});
