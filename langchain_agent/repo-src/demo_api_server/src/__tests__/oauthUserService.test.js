/**
 * @file oauthUserService.test.js
 * @description Unit tests for end-user OAuth authorize URL (pi.flow vs code).
 */

jest.mock('../../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));

const MOCK_USER_CONFIG = {
  authorizationEndpoint: 'https://auth.pingone.com/env-x/as/authorize',
  clientId: 'user-client-id',
  redirectUri: 'https://app.example/cb',
  scopes: ['openid', 'profile', 'email'],
  authorizeUsesPiFlow: false,
};

jest.mock('../../config/oauthUser', () => MOCK_USER_CONFIG);

const oauthUserService = require('../../services/oauthUserService');

describe('OAuthUserService.generateAuthorizationUrl', () => {
  const verifier = 'a'.repeat(32);

  it('uses response_type=code when pi.flow is off and forcePiFlow is not set', () => {
    const url = oauthUserService.generateAuthorizationUrl({ state: 'state-1', codeVerifier: verifier });
    expect(url).toContain('response_type=code');
    expect(url).not.toContain('response_type=pi.flow');
    expect(url).not.toContain('response_mode=pi.flow');
  });

  it('uses pi.flow when forcePiFlow is true even if global authorizeUsesPiFlow is false', () => {
    const url = oauthUserService.generateAuthorizationUrl({ state: 'state-2', codeVerifier: verifier, forcePiFlow: true });
    expect(url).toContain('response_type=pi.flow');
    expect(url).toContain('response_mode=pi.flow');
    expect(url).toContain('code_challenge=');
  });
});
