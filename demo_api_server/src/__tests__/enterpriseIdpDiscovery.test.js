'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'https://api.ping.demo:3001') }));

const enterpriseIdpRouter = require('../../routes/enterpriseIdp');

describe('enterpriseIdp discovery document', () => {
  test('endpoints are all under {issuer}/api/enterprise-idp/*', () => {
    const doc = enterpriseIdpRouter.buildDiscoveryDocument();
    expect(doc.issuer).toBe('https://api.ping.demo:3001');
    expect(doc.authorization_endpoint).toBe('https://api.ping.demo:3001/api/enterprise-idp/authorize');
    expect(doc.token_endpoint).toBe('https://api.ping.demo:3001/api/enterprise-idp/token');
    expect(doc.jwks_uri).toBe('https://api.ping.demo:3001/api/enterprise-idp/jwks');
  });

  test('advertises PKCE S256, RS256 ID tokens, and the RFC 8693 token-exchange grant', () => {
    const doc = enterpriseIdpRouter.buildDiscoveryDocument();
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(doc.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'urn:ietf:params:oauth:grant-type:token-exchange']),
    );
  });
});
