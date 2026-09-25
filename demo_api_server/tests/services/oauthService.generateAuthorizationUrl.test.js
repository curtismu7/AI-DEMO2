'use strict';

// generateAuthorizationUrl's loginHint param defaults to 'demoAdmin' so
// routes/oauth.js's admin login (4 positional args, unchanged) keeps its exact
// URL. routes/davinciLogin.js passes an explicit null: that route signs in
// whoever the DaVinci widget just authenticated, and hardcoding a hint there
// pre-fills PingOne's re-auth screen with the wrong username — producing a
// genuine "incorrect username and password" once the real user submits their
// own credentials against a form still addressed to demoAdmin.

// oauthService.config is the real config/oauth.js singleton, whose
// authorizationEndpoint resolves via live OIDC discovery — unmocked, this
// throws/produces "undefined?..." outside a running BFF. Mock it so the test
// exercises generateAuthorizationUrl's own logic, not discovery state.
jest.mock('../../config/oauth', () => ({
  authorizationEndpoint: 'https://auth.pingone.com/env-1/as/authorize',
  clientId: 'client-1',
  redirectUri: 'https://x/default-cb',
  scopes: ['openid', 'profile'],
  authorizeUsesPiFlow: false,
}));

jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const configStore = require('../../services/configStore');

function hintOf(url) {
  return new URL(url).searchParams.get('login_hint');
}

test('defaults to demoAdmin when no loginHint is passed (routes/oauth.js unaffected)', () => {
  configStore.getOAuthProvider.mockReturnValue('pingone');
  const url = oauthService.generateAuthorizationUrl('state-1', 'verifier-1', 'https://x/cb', 'nonce-1');
  expect(hintOf(url)).toBe('demoAdmin');
});

test('defaults to demoadmin in PingFederate mode', () => {
  configStore.getOAuthProvider.mockReturnValue('pingfederate');
  const url = oauthService.generateAuthorizationUrl('state-1', 'verifier-1', 'https://x/cb', 'nonce-1');
  expect(hintOf(url)).toBe('demoadmin');
});

test('omits login_hint entirely when explicitly passed null', () => {
  configStore.getOAuthProvider.mockReturnValue('pingfederate');
  const url = oauthService.generateAuthorizationUrl('state-1', 'verifier-1', 'https://x/cb', 'nonce-1', null);
  expect(url).not.toContain('login_hint');
});
