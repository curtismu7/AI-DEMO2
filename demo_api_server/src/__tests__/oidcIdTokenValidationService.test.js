'use strict';

jest.mock('../../services/tokenValidationService', () => ({ validateToken: jest.fn() }));

const { validateToken } = require('../../services/tokenValidationService');
const { validateIdToken, assertUserInfoSubjectMatches } = require('../../services/oidcIdTokenValidationService');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (alg = 'RS256') => `${b64({ alg, typ: 'JWT' })}.${b64({})}.sig`;

const config = { jwksEndpoint: 'https://idp/jwks', issuer: 'https://idp', clientId: 'client-1' };
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (over = {}) => ({
  iss: 'https://idp', sub: 'user-1', aud: 'client-1', exp: now() + 300, iat: now(), nonce: 'n-1', ...over,
});
const run = (claims, opts = {}, token = idToken()) => {
  validateToken.mockResolvedValue(claims);
  return validateIdToken(token, { config, expectedNonce: 'n-1', ...opts });
};
const reason = (p) => p.then(() => null, (e) => e.reasonCode);

beforeEach(() => validateToken.mockReset());

describe('validateIdToken', () => {
  test('accepts a valid token and returns its claims', async () => {
    await expect(run(goodClaims())).resolves.toMatchObject({ sub: 'user-1' });
    expect(validateToken).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      jwksUri: config.jwksEndpoint, issuer: config.issuer, audience: config.clientId,
    }));
  });

  test.each([
    ['missing token', () => validateIdToken('', { config, expectedNonce: 'n-1' }), 'id_token_missing'],
    ['missing expected nonce', () => validateIdToken(idToken(), { config }), 'nonce_missing'],
    ['alg none', () => validateIdToken(idToken('none'), { config, expectedNonce: 'n-1' }), 'id_token_invalid'],
    ['HS256 (key confusion)', () => validateIdToken(idToken('HS256'), { config, expectedNonce: 'n-1' }), 'id_token_invalid'],
    ['no jwks endpoint', () => validateIdToken(idToken(), { config: { ...config, jwksEndpoint: '' }, expectedNonce: 'n-1' }), 'id_token_validation_unconfigured'],
  ])('rejects %s', async (_n, call, code) => {
    expect(await reason(call())).toBe(code);
  });

  test('rejects when signature verification fails', async () => {
    validateToken.mockRejectedValue(new Error('bad sig'));
    expect(await reason(validateIdToken(idToken(), { config, expectedNonce: 'n-1' }))).toBe('id_token_invalid');
  });

  test.each([
    ['wrong issuer', { iss: 'https://evil' }],
    ['wrong audience', { aud: 'other' }],
    ['expired', { exp: now() - 5 }],
    ['issued in the future', { iat: now() + 3600 }],
    ['missing sub', { sub: undefined }],
    ['non-ASCII sub', { sub: 'üser' }],
    ['multi-aud without azp', { aud: ['client-1', 'other'] }],
    ['azp for another client', { azp: 'other' }],
  ])('rejects %s', async (_n, over) => {
    expect(await reason(run(goodClaims(over)))).toBe('id_token_invalid');
  });

  test('accepts multi-aud when azp is this client', async () => {
    await expect(run(goodClaims({ aud: ['client-1', 'other'], azp: 'client-1' }))).resolves.toBeDefined();
  });

  test('rejects missing and mismatched nonce', async () => {
    expect(await reason(run(goodClaims({ nonce: undefined })))).toBe('nonce_missing');
    expect(await reason(run(goodClaims({ nonce: 'replayed' })))).toBe('nonce_mismatch');
  });

  test('maxAge: requires auth_time and rejects a stale authentication', async () => {
    expect(await reason(run(goodClaims(), { maxAgeSeconds: 0 }))).toBe('auth_time_missing');
    expect(await reason(run(goodClaims({ auth_time: now() - 600 }), { maxAgeSeconds: 0 }))).toBe('authentication_too_old');
    await expect(run(goodClaims({ auth_time: now() }), { maxAgeSeconds: 0 })).resolves.toBeDefined();
  });

  test('step-up: acr must be one of the requested values', async () => {
    expect(await reason(run(goodClaims({ acr: 'Single_Factor' }), { expectedAcr: 'Multi_Factor' }))).toBe('stepup_acr_mismatch');
    await expect(run(goodClaims({ acr: 'Multi_Factor' }), { expectedAcr: 'Multi_Factor' })).resolves.toBeDefined();
  });
});

describe('assertUserInfoSubjectMatches', () => {
  test('passes on equal subjects, throws otherwise', () => {
    expect(() => assertUserInfoSubjectMatches({ sub: 'a' }, { sub: 'a' })).not.toThrow();
    for (const [ui, c] of [[{ sub: 'b' }, { sub: 'a' }], [{}, { sub: 'a' }], [null, { sub: 'a' }]]) {
      expect(() => assertUserInfoSubjectMatches(ui, c)).toThrow(expect.objectContaining({ reasonCode: 'userinfo_subject_mismatch' }));
    }
  });
});
