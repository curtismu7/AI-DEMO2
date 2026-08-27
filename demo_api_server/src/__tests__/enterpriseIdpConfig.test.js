'use strict';

const configStore = require('../../services/configStore');

const { FIELD_DEFS } = configStore;

// getEffective() returns '' for UNREGISTERED keys too, so asserting on it alone
// would pass whether or not the key exists. FIELD_DEFS is the registration
// itself — assert there, then assert the value.
describe('enterprise IdP config keys', () => {
  test.each([
    'enterprise_idp_issuer',
    'enterprise_idp_jwks_url',
    'enterprise_mcp_as_token_url',
    'enterprise_mcp_policy_cache_ttl_ms',
  ])('%s is a registered config key', (key) => {
    expect(Object.prototype.hasOwnProperty.call(FIELD_DEFS, key)).toBe(true);
  });

  test('native-mode keys default to empty so native mode is OFF by default', () => {
    expect(FIELD_DEFS.enterprise_idp_issuer.default).toBe('');
    expect(FIELD_DEFS.enterprise_idp_jwks_url.default).toBe('');
    expect(FIELD_DEFS.enterprise_mcp_as_token_url.default).toBe('');
    expect(configStore.getEffective('enterprise_idp_issuer')).toBe('');
    expect(configStore.getEffective('enterprise_idp_jwks_url')).toBe('');
  });

  test('policy cache TTL default is unchanged at 5 minutes', () => {
    expect(FIELD_DEFS.enterprise_mcp_policy_cache_ttl_ms.default).toBe('300000');
    expect(String(configStore.getEffective('enterprise_mcp_policy_cache_ttl_ms'))).toBe('300000');
  });

  // routes/featureFlags.js's PINNED_ENV_ALIASES lists FF_ENTERPRISE_MANAGED_MCP_AUTH
  // under the rule "Only flags with an env alias in configStore's fallback map
  // belong here" — this asserts that alias actually exists, not just the claim.
  test('FF_ENTERPRISE_MANAGED_MCP_AUTH env var drives ff_enterprise_managed_mcp_auth', () => {
    const ORIG = process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH;
    try {
      process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH = 'true';
      expect(configStore.getEffective('ff_enterprise_managed_mcp_auth')).toBe('true');
    } finally {
      if (ORIG === undefined) delete process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH;
      else process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH = ORIG;
    }
  });
});
