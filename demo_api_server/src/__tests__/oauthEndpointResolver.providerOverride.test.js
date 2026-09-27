'use strict';

jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn((key) => ({
    pf_discovery_endpoint: '',
    pf_issuer: 'https://pf.example.test',
    oauth_discovery_endpoint: 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration',
    pingone_region: 'com',
    pingone_environment_id: 'env-1',
  }[key] ?? '')),
}));

const resolver = require('../../services/oauthEndpointResolver');

test('resolves PF discovery while PingOne remains the selected provider', () => {
  expect(resolver.getDiscoveryEndpoint('pingfederate'))
    .toBe('https://pf.example.test/.well-known/openid-configuration');
});

test('does not use a shared discovery endpoint for an explicit PF preflight', () => {
  expect(resolver.getDiscoveryEndpoint('pingfederate'))
    .not.toBe('https://auth.pingone.com/env-1/as/.well-known/openid-configuration');
});
