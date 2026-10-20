'use strict';

jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn((key) => ({
    pf_discovery_endpoint: '',
    pf_issuer: 'https://pf.example.test',
    pf_authorization_endpoint: '',
    pf_token_endpoint: '',
    pf_userinfo_endpoint: '',
    pf_jwks_uri: '',
    oauth_discovery_endpoint: 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration',
    oauth_discovery_enabled: 'true',
    oauth_authorization_endpoint: 'https://auth.pingone.com/env-1/as/authorize',
    oauth_token_endpoint: 'https://auth.pingone.com/env-1/as/token',
    oauth_userinfo_endpoint: 'https://auth.pingone.com/env-1/as/userinfo',
    oauth_jwks_uri: 'https://auth.pingone.com/env-1/as/jwks',
    pingone_region: 'com',
    pingone_environment_id: 'env-1',
  }[key] ?? '')),
}));
jest.mock('../../services/oauthDiscoveryService', () => ({
  fetchDiscoveryMetadata: jest.fn().mockResolvedValue({ issuer: 'https://pingone.example.test' }),
  extractEndpoints: jest.fn(() => ({ token_endpoint: 'https://pingone.example.test/token' })),
  persistDiscoveredEndpoints: jest.fn(),
}));

const resolver = require('../../services/oauthEndpointResolver');
const configStore = require('../../services/configStore');

test('resolves PF discovery while PingOne remains the selected provider', () => {
  expect(resolver.getDiscoveryEndpoint('pingfederate'))
    .toBe('https://pf.example.test/.well-known/openid-configuration');
});

test('does not use a shared discovery endpoint for an explicit PF preflight', () => {
  expect(resolver.getDiscoveryEndpoint('pingfederate'))
    .not.toBe('https://auth.pingone.com/env-1/as/.well-known/openid-configuration');
});

test('selected PF runtime resolution does not reuse shared PingOne endpoints', () => {
  configStore.getOAuthProvider.mockReturnValue('pingfederate');

  expect(resolver.getDiscoveryEndpoint())
    .toBe('https://pf.example.test/.well-known/openid-configuration');
  expect(resolver.getAuthorizationEndpoint()).toBe('');
  expect(resolver.getTokenEndpoint()).toBe('');
  expect(resolver.getUserInfoEndpoint()).toBe('');
  expect(resolver.getJwksUri()).toBe('');
});

test('selected PF runtime resolution does not use a PingOne discovery cache', async () => {
  configStore.getOAuthProvider.mockReturnValue('pingone');
  await resolver.initializeDiscovery();
  expect(resolver.getTokenEndpoint()).toBe('https://auth.pingone.com/env-1/as/token');

  configStore.getOAuthProvider.mockReturnValue('pingfederate');
  expect(resolver.getTokenEndpoint()).toBe('');
});

test('explicit pingone resolves PingOne discovery while PF is selected (SDK / DaVinci demo configs)', () => {
  configStore.getOAuthProvider.mockReturnValue('pingfederate');
  expect(resolver.getDiscoveryEndpoint('pingone'))
    .toBe('https://auth.pingone.com/env-1/as/.well-known/openid-configuration');
});
