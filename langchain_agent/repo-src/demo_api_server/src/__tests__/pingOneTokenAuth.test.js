/**
 * pingOneTokenAuth — auth-method fallback ordering + invalid_client detection.
 * Guards the self-heal that prevents a stale pingone_mgmt_token_auth_method (basic vs
 * post) from wedging the worker/management token against an app of the other method.
 */
'use strict';

const { authMethodOrder, isInvalidClientError } = require('../../services/pingOneTokenAuth');

describe('authMethodOrder', () => {
  test('basic → [basic, post]', () => expect(authMethodOrder('basic')).toEqual(['basic', 'post']));
  test('post → [post, basic]', () => expect(authMethodOrder('post')).toEqual(['post', 'basic']));
  test('default/empty → [basic, post]', () => expect(authMethodOrder()).toEqual(['basic', 'post']));
  test('case-insensitive', () => expect(authMethodOrder('POST')).toEqual(['post', 'basic']));
  test('jwt/none are explicit — no fallback', () => {
    expect(authMethodOrder('client_secret_jwt')).toEqual(['client_secret_jwt']);
    expect(authMethodOrder('private_key_jwt')).toEqual(['private_key_jwt']);
    expect(authMethodOrder('none')).toEqual(['none']);
  });
});

describe('isInvalidClientError', () => {
  const err = (status, data) => ({ response: { status, data } });
  test('401 invalid_client → true', () => expect(isInvalidClientError(err(401, { error: 'invalid_client' }))).toBe(true));
  test('400 invalid_client in description → true', () =>
    expect(isInvalidClientError(err(400, { error_description: 'invalid_client: bad secret' }))).toBe(true));
  test('400 unsupported grant type → false (not a client-auth error)', () =>
    expect(isInvalidClientError(err(400, { error: 'unauthorized_client', error_description: 'Unsupported grant type' }))).toBe(false));
  test('403 → false', () => expect(isInvalidClientError(err(403, { error: 'invalid_client' }))).toBe(false));
  test('network error (no response) → false', () => expect(isInvalidClientError(new Error('ECONNRESET'))).toBe(false));
});
