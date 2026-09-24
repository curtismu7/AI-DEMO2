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

describe('OAuthUserService.createUserFromOAuth issuer identity', () => {
  it('marks the configured PingFederate issuer for the PF DaVinci demo gate', () => {
    MOCK_USER_CONFIG.issuer = 'https://federate.example.test:9031';
    MOCK_USER_CONFIG.authorizationEndpoint = 'https://federate.example.test:9031/as/authorization.oauth2';
    MOCK_USER_CONFIG.tokenEndpoint = 'https://federate.example.test:9031/as/token.oauth2';
    const user = oauthUserService.createUserFromOAuth({
      sub: 'pf-user',
      preferred_username: 'pf-user',
      iss: 'https://federate.example.test:9031',
    });

    expect(user.oauthProvider).toBe('pingfederate');
    expect(user.oauthIssuer).toBe('https://federate.example.test:9031');
  });

  it('keeps PingOne sessions distinct from PingFederate sessions', () => {
    MOCK_USER_CONFIG.issuer = 'https://auth.pingone.com/env-x/as';
    MOCK_USER_CONFIG.authorizationEndpoint = 'https://auth.pingone.com/env-x/as/authorize';
    MOCK_USER_CONFIG.tokenEndpoint = 'https://auth.pingone.com/env-x/as/token';
    const user = oauthUserService.createUserFromOAuth({
      sub: 'p1-user',
      preferred_username: 'p1-user',
      iss: 'https://auth.pingone.com/env-x/as',
    });

    expect(user.oauthProvider).toBe('pingone_sso');
    expect(user.oauthIssuer).toBe('https://auth.pingone.com/env-x/as');
  });

  it('does not label an unknown OIDC issuer as PingFederate', () => {
    MOCK_USER_CONFIG.issuer = 'https://login.example.test';
    MOCK_USER_CONFIG.authorizationEndpoint = 'https://login.example.test/oauth2/authorize';
    MOCK_USER_CONFIG.tokenEndpoint = 'https://login.example.test/oauth2/token';
    const user = oauthUserService.createUserFromOAuth({
      sub: 'other-user',
      preferred_username: 'other-user',
      iss: 'https://login.example.test',
    });

    expect(user.oauthProvider).toBe('oidc');
  });
});
