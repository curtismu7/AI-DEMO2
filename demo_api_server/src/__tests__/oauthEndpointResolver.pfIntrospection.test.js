'use strict';

// PF's introspection endpoint falls back to the token endpoint's sibling. The discovery
// cache only holds the provider active at startup, so when PF is selected afterwards
// (the BFF started on PingOne) it is empty and nothing sets PF_INTROSPECTION_ENDPOINT.

let mockConfig = {};
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn((key) => mockConfig[key] ?? ''),
}));

const resolver = require('../../services/oauthEndpointResolver');

beforeEach(() => { mockConfig = {}; });

test('an explicit PF introspection endpoint wins', () => {
  mockConfig = {
    pf_introspection_endpoint: 'https://pf.example.test:9031/as/custom-introspect',
    pf_token_endpoint: 'https://pingfederate:9031/as/token.oauth2',
  };
  expect(resolver.getIntrospectionEndpoint('pingfederate')).toBe('https://pf.example.test:9031/as/custom-introspect');
});

test('derives the PF introspection endpoint from the PF token endpoint while PingOne is the active provider', () => {
  mockConfig = { pf_token_endpoint: 'https://pingfederate:9031/as/token.oauth2' };
  expect(resolver.getIntrospectionEndpoint('pingfederate')).toBe('https://pingfederate:9031/as/introspect.oauth2');
});

test('is empty when PF has neither an introspection nor a token endpoint configured', () => {
  expect(resolver.getIntrospectionEndpoint('pingfederate')).toBe('');
});

test('does not guess from a token endpoint that is not PF-shaped', () => {
  mockConfig = { pf_token_endpoint: 'https://example.test/oauth/token' };
  expect(resolver.getIntrospectionEndpoint('pingfederate')).toBe('');
});

test('leaves the PingOne branch alone', () => {
  mockConfig = {
    pf_token_endpoint: 'https://pingfederate:9031/as/token.oauth2',
    pingone_environment_id: 'env-1',
    pingone_region: 'com',
  };
  expect(resolver.getIntrospectionEndpoint('pingone')).toBe('https://auth.pingone.com/env-1/as/introspect');
});
