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

    expect(getFeatureStatus(store)).toEqual({ cimd: false, crossDomain: false, rar: false, rarDpop: false });
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

  // The local BFF names PingFederate by its Docker alias for the token and JWKS
  // endpoints while the issuer is the public host. Those must resolve onto the
  // issuer's origin rather than be rejected — and never anywhere else.
  describe('PF endpoints configured on a host other than the issuer', () => {
    const crossDomain = (overrides) => resolveCrossDomainConfig(makeStore({
      pf_issuer: 'https://pf.example.test:9031',
      pf_jwks_uri: 'https://pingfederate:9031/pf/JWKS',
      pf_token_endpoint: 'https://pingfederate:9031/as/token.oauth2',
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
      ...overrides,
    }));

    test('are moved onto the issuer origin, keeping the configured path', () => {
      expect(crossDomain()).toEqual(expect.objectContaining({
        pfTokenEndpoint: 'https://pf.example.test:9031/as/token.oauth2',
        pfJwksUri: 'https://pf.example.test:9031/pf/JWKS',
      }));
    });

    test('can never point a PF request at another host, whatever is configured', () => {
      const config = crossDomain({ pf_token_endpoint: 'https://attacker.example.test/as/token.oauth2' });
      expect(new URL(config.pfTokenEndpoint).origin).toBe('https://pf.example.test:9031');
    });

    test('are still rejected when not HTTPS or when they carry credentials', () => {
      for (const endpoint of ['http://pingfederate:9031/as/token.oauth2', 'https://user:pass@pingfederate:9031/as/token.oauth2']) {
        expect(() => crossDomain({ pf_token_endpoint: endpoint })).toThrow(expect.objectContaining({ code: 'PF_AI_CROSS_DOMAIN_CONFIG_INVALID' }));
      }
    });

    test('leave the third-party token endpoint on its own host', () => {
      expect(crossDomain().thirdPartyTokenEndpoint).toBe('https://downstream.example.test/token');
    });
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
