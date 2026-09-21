'use strict';

const { __test } = require('../../services/agentMcpTokenService');

describe('PF ID-JAG subject token selection', () => {
  test('uses the configured refresh token by default', () => {
    expect(__test.resolvePfIdJagSubjectToken({
      session: { oauthTokens: { refreshToken: 'refresh', idToken: 'id', accessToken: 'access' } },
    })).toEqual({
      token: 'refresh',
      type: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
  });

  test('selects the matching server-held token type', () => {
    expect(__test.resolvePfIdJagSubjectToken(
      { session: { oauthTokens: { idToken: 'id' } } },
      'urn:ietf:params:oauth:token-type:id_token',
    )).toEqual({ token: 'id', type: 'urn:ietf:params:oauth:token-type:id_token' });
  });

  test('fails closed when the requested subject token is absent', () => {
    expect(() => __test.resolvePfIdJagSubjectToken(
      { session: { oauthTokens: { refreshToken: '_cookie_session' } } },
    )).toThrow(/subject token is not available/i);
  });
});
