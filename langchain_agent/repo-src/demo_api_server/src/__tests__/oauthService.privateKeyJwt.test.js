/**
 * @file oauthService.privateKeyJwt.test.js
 * @description Integration test for the private_key_jwt branch wired into
 * oauthService's token-endpoint auth (ff_token_auth_private_key_jwt ON).
 *
 * Asserts exchangeCodeForToken sends client_assertion + client_assertion_type
 * (RFC 7521/7523) and NO client_secret / Basic header when the flag is on.
 * Kept isolated from oauthService.test.js so the flag/configStore mock here
 * doesn't bleed into the (secret-based) tests there.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

jest.mock('axios');
const axios = require('axios');

// Quiet the debug helpers + token-chain side effects.
jest.mock('../../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));
jest.mock('../../services/tokenChainService', () => ({ trackTokenEvent: jest.fn(() => Promise.resolve()) }));

const MOCK_CONFIG = {
  tokenEndpoint: 'https://auth.pingone.com/env-pkj/as/token',
  clientId: 'bff-admin-client',
  clientSecret: 'bff-admin-secret',
  redirectUri: 'https://demo-api-server:3001/api/auth/oauth/callback',
  scopes: ['openid'],
  tokenEndpointAuthMethod: 'basic',
};
jest.mock('../../config/oauth', () => MOCK_CONFIG);

// Private key the mocked configStore serves + the flag turned ON.
const mockKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = mockKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const mockCfg = {
  ff_token_auth_private_key_jwt: 'true',
  pingone_client_jwt_private_key: PRIVATE_PEM,
  pingone_client_jwt_kid: 'pkj-test-kid',
};
jest.mock('../../services/configStore', () => ({ getEffective: (k) => mockCfg[k] }));

const svc = require('../../services/oauthService');

test('exchangeCodeForToken sends client_assertion and no secret when flag ON', async () => {
  axios.post.mockResolvedValue({ data: { access_token: 'not-a-jwt', expires_in: 3600 } });

  await svc.exchangeCodeForToken('auth-code', 'verifier', MOCK_CONFIG.redirectUri);

  expect(axios.post).toHaveBeenCalledTimes(1);
  const [url, bodyStr, opts] = axios.post.mock.calls[0];
  expect(url).toBe(MOCK_CONFIG.tokenEndpoint);

  const params = new URLSearchParams(bodyStr);
  expect(params.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
  );
  expect(params.get('client_id')).toBe(MOCK_CONFIG.clientId);
  expect(params.get('client_secret')).toBeNull();
  expect(opts.headers.Authorization).toBeUndefined();

  // The assertion is a real signed JWT for the admin client.
  const assertion = params.get('client_assertion');
  expect(assertion).toBeTruthy();
  const pubJwk = { ...crypto.createPublicKey(PRIVATE_PEM).export({ format: 'jwk' }) };
  const claims = jwt.verify(assertion, crypto.createPublicKey({ key: pubJwk, format: 'jwk' }), {
    algorithms: ['RS256'],
  });
  expect(claims.iss).toBe(MOCK_CONFIG.clientId);
  expect(claims.aud).toBe(MOCK_CONFIG.tokenEndpoint);
});
