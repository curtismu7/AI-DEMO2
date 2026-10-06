'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { beginRar, completeRar } = require('../services/pfAiAgentRarService');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const CLIENT = 'ai-demo-pf-rar';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pf-key', use: 'sig', alg: 'RS256' };

const store = {
  getEffective: (key) => ({
    pf_ai_cimd_enabled: 'true',
    pf_ai_rar_enabled: 'true',
    pf_ai_rar_client_id: CLIENT,
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_par_endpoint: 'https://pf.example.test/as/par.oauth2',
  }[String(key).toLowerCase()] || ''),
};

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } });
const discovery = () => json({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: 'https://pf.example.test/as/token.oauth2',
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  pushed_authorization_request_endpoint: 'https://pf.example.test/as/par.oauth2',
});

const SECRETS = {
  code: 'authorization-code-secret',
  accessToken: 'header.at-claims-part.at-signature-secret',
  refreshToken: 'refresh-token-secret',
};

describe('RAR proof trace', () => {
  async function runToTheCallback() {
    const req = { session: { oauthProvider: 'pingfederate', user: { username: 'demouser' } } };
    const parResponse = json({ request_uri: 'urn:ietf:params:oauth:request_uri:one-time-handle-value', expires_in: 90 }, 201);
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(parResponse);
    await beginRar(req, { scenario: 'allowed', store, fetchImpl });
    return { req, pending: req.session.pfAiAgent.rarPending };
  }

  test('records the pushed request and PingFederate\'s answer, then the browser redirect', async () => {
    const { pending } = await runToTheCallback();
    const [par, authorize] = pending.trace;

    expect(par).toMatchObject({ id: 'par', request: { method: 'POST', url: 'https://pf.example.test/as/par.oauth2' } });
    expect(par.request.params.authorization_details[0]).toMatchObject({ type: 'banking_transaction', user_id: 'demouser' });
    expect(par.request.params.client_id).toBe(CLIENT);
    expect(par.request.params.login_hint).toBe('demouser');
    expect(par.response).toMatchObject({ status: 201, body: { expires_in: 90 } });
    expect(par.response.body.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:one-time/);
    expect(par.response.body.request_uri).not.toContain('one-time-handle-value');
    expect(authorize.request.url).toBe('https://pf.example.test/as/authorization.oauth2');
    expect(Object.keys(authorize.request.params)).toEqual(['client_id', 'request_uri']);
  });

  test('never puts the PKCE verifier, the full state or nonce, or the full challenge in the trace', async () => {
    const { pending } = await runToTheCallback();
    const text = JSON.stringify(pending.trace);

    expect(text).not.toContain(pending.verifier);
    expect(text).not.toContain(pending.state);
    expect(text).not.toContain(pending.nonce);
    expect(pending.trace[0].request.params.code_challenge).toMatch(/\.\.\.$/);
  });

  test('a completed run adds the callback and the token call, with the granted details and decoded identity', async () => {
    const { req, pending } = await runToTheCallback();
    const idToken = jwt.sign(
      { sub: 'demouser', nonce: pending.nonce, iss: 'https://pf.example.test', aud: CLIENT, acr: 'pwd' },
      privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 },
    );
    const granted = [{ type: 'banking_transaction', user_id: 'demouser', actions: ['transfer'] }];
    const tokenResponse = json({
      id_token: idToken,
      access_token: SECRETS.accessToken,
      refresh_token: SECRETS.refreshToken,
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'openid',
      authorization_details: granted,
    });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(json({ keys: [jwk] }));
    req.query = { state: pending.state, code: SECRETS.code };

    const done = await completeRar(req, { store, fetchImpl });

    expect(done.trace.map((step) => step.id)).toEqual(['par', 'authorize', 'callback', 'token']);
    const token = done.trace[3];
    expect(token.request.params.grant_type).toBe('authorization_code');
    expect(token.request.params.code).toMatch(/^<redacted/);
    expect(token.request.params.code_verifier).toMatch(/^<redacted/);
    expect(token.response.body.authorization_details).toEqual(granted);
    expect(token.response.body.access_token).toMatch(/^<redacted JWT/);
    expect(token.claims.idToken).toMatchObject({ sub: 'demouser', acr: 'pwd' });
    const text = JSON.stringify(done);
    for (const secret of [SECRETS.code, SECRETS.accessToken, SECRETS.refreshToken, idToken, pending.verifier]) {
      expect(text).not.toContain(secret);
    }
  });

  test('a refusal shows our classification of it, never PingFederate\'s own text from the callback URL', async () => {
    const { req, pending } = await runToTheCallback();
    req.query = { state: pending.state, error: 'access_denied', error_description: 'attacker-controlled text' };

    const done = await completeRar(req, { store, fetchImpl: jest.fn() });

    expect(done.trace.map((step) => step.id)).toEqual(['par', 'authorize', 'callback']);
    expect(JSON.stringify(done)).not.toMatch(/attacker-controlled|access_denied/);
    expect(done.trace[2].request.params.error).toMatch(/classified as/);
  });
});
