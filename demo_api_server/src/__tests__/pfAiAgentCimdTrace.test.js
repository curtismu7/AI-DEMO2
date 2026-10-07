'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { beginCimd, completeCimd } = require('../../services/pfAiAgentCimdService');

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pf-key', use: 'sig', alg: 'RS256' };
const values = {
  pf_ai_cimd_enabled: 'true',
  pf_issuer: 'https://pf.example.test',
  pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
  pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
  pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
};
const store = { getEffective: (key) => values[String(key).toLowerCase()] || '' };
const json = (data) => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } });
const discovery = () => json({
  issuer: values.pf_issuer,
  authorization_endpoint: values.pf_authorization_endpoint,
  token_endpoint: values.pf_token_endpoint,
  jwks_uri: values.pf_jwks_uri,
});
const SECRETS = { code: 'authorization-code-secret', accessToken: 'header.at-part.at-signature-secret', refreshToken: 'refresh-token-secret' };

test('CIMD run: the metadata document, the authorize request, the callback and the token call, with no secrets', async () => {
  const req = { session: { oauthProvider: 'pingfederate', user: { username: 'demouser' } } };
  await beginCimd(req, { store, fetchImpl: jest.fn().mockResolvedValueOnce(discovery()) });
  const pending = req.session.pfAiAgent.cimdPending;
  const [metadata, authorize] = pending.trace;

  expect(metadata).toMatchObject({ id: 'metadata', response: { status: 200, body: { token_endpoint_auth_method: 'none' } } });
  expect(authorize.request.url).toBe(values.pf_authorization_endpoint);
  expect(authorize.request.params.client_id).toBe(metadata.request.url);
  expect(authorize.request.params.login_hint).toBe('demouser');
  expect(authorize.request.params.code_challenge).toMatch(/\.\.\.$/);

  const idToken = jwt.sign(
    { sub: 'demouser', nonce: pending.nonce, iss: values.pf_issuer, aud: metadata.request.url },
    privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 },
  );
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(discovery())
    .mockResolvedValueOnce(json({
      id_token: idToken, access_token: SECRETS.accessToken, refresh_token: SECRETS.refreshToken, token_type: 'Bearer', expires_in: 300,
    }))
    .mockResolvedValueOnce(json({ keys: [jwk] }));
  req.query = { state: pending.state, code: SECRETS.code };

  await completeCimd(req, { store, fetchImpl });

  const result = req.session.pfAiAgent.cimdResult;
  expect(result.trace.map((s) => s.id)).toEqual(['metadata', 'authorize', 'callback', 'token']);
  expect(result.trace[3].claims.idToken).toMatchObject({ sub: 'demouser' });
  expect(result).toMatchObject({ subject: 'demouser', issuer: values.pf_issuer });
  const text = JSON.stringify(result);
  for (const secret of [SECRETS.code, SECRETS.accessToken, SECRETS.refreshToken, idToken, pending.verifier, pending.state]) {
    expect(text).not.toContain(secret);
  }
});
