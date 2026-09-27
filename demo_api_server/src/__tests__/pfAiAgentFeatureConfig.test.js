'use strict';

const {
  resolveCimdConfig,
  resolveCrossDomainConfig,
  getFeatureStatus,
} = require('../../services/pfAiAgentFeatureConfig');

function makeStore(values = {}) {
  return {
    getEffective: jest.fn((key) => values[String(key).toLowerCase()] ?? ''),
    getOAuthProvider: jest.fn(() => 'pingone'),
  };
}

describe('PF AI Agent feature configuration', () => {
  test('keeps feature flags disabled by default and never changes the active provider', () => {
    const store = makeStore();

    expect(getFeatureStatus(store)).toEqual({ cimd: false, crossDomain: false, rar: false });
    expect(store.getOAuthProvider()).toBe('pingone');
    expect(store.getEffective).not.toHaveBeenCalledWith('oauth_provider');
  });

  test('requires an HTTPS PF issuer and complete discovery endpoints for CIMD', () => {
    const store = makeStore({
      pf_issuer: 'http://pf.example.test',
      pf_authorization_endpoint: 'http://pf.example.test/as/authorize',
      pf_token_endpoint: 'http://pf.example.test/as/token',
      pf_jwks_uri: 'http://pf.example.test/pf/JWKS',
      pf_par_endpoint: 'http://pf.example.test/as/par',
    });

    expect(() => resolveCimdConfig(store)).toThrow(expect.objectContaining({
      code: 'PF_AI_CIMD_CONFIG_INVALID',
      httpStatus: 503,
    }));
  });

  test('keeps PF and downstream client secrets private in resolved readiness data', () => {
    const store = makeStore({
      pf_issuer: 'https://pf.example.test',
      pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
      pf_token_endpoint: 'https://pf.example.test/as/token',
      pf_ai_cross_domain_enabled: 'true',
      pf_ai_cross_domain_client_id: 'pf-exchange-client',
      pf_ai_cross_domain_client_secret: 'pf-test-client-secret',
      pf_ai_cross_domain_audience: 'https://downstream.example.test',
      pf_ai_cross_domain_resource: 'https://downstream.example.test/accounts',
      pf_ai_cross_domain_scope: 'accounts:read',
      pf_ai_third_party_token_endpoint: 'https://downstream.example.test/token',
      pf_ai_third_party_client_id: 'downstream-client',
      pf_ai_third_party_client_secret: 'downstream-test-client-secret',
      pf_ai_third_party_resource: 'https://downstream.example.test/accounts',
      pf_ai_third_party_scope: 'accounts:read',
    });

    expect(resolveCrossDomainConfig(store)).toEqual(expect.objectContaining({
      pfClientId: 'pf-exchange-client',
      thirdPartyClientId: 'downstream-client',
    }));
    expect(JSON.stringify(getFeatureStatus(store))).not.toContain('test-client-secret');
  });
});
