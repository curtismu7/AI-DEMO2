'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { startCiba, pollCiba, mockDecideCiba } = require('../services/pfAiAgentCibaService');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const CLIENT_ID = 'ai-demo-pf-ciba';
const CLIENT_SECRET = 'ciba-client-secret-value';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pf-key', use: 'sig', alg: 'RS256' };

function makeStore(overrides = {}) {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_ai_ciba_enabled: 'true',
    pf_ai_ciba_client_id: CLIENT_ID,
    pf_ai_ciba_client_secret: CLIENT_SECRET,
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const discovery = () => json({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: 'https://pf.example.test/as/token.oauth2',
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  backchannel_authentication_endpoint: 'https://pf.example.test/as/bc-auth.ciba',
});
const idToken = () => jwt.sign(
  { sub: 'demouser', iss: 'https://pf.example.test', aud: CLIENT_ID },
  privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 },
);

const AUTH_REQ_ID = 'auth-req-secret-id';
const req = () => ({ session: { oauthProvider: 'pingfederate', user: { username: 'demouser' } } });
let clock;
const now = () => clock;
beforeEach(() => { clock = 1_700_000_000_000; });

async function started() {
  const request_ = req();
  const fetchImpl = jest.fn().mockResolvedValueOnce(discovery())
    .mockResolvedValueOnce(json({ auth_req_id: AUTH_REQ_ID, expires_in: 120, interval: 3 }));
  const view = await startCiba(request_, { loginHint: 'demouser', bindingMessage: 'Approve-125', store: makeStore(), fetchImpl, now });
  return { request_, view };
}

describe('CIBA proof trace', () => {
  test('the pending view carries the start request and PingFederate\'s answer, with the auth_req_id replaced', async () => {
    const { view } = await started();

    expect(view.trace).toHaveLength(1);
    const [start] = view.trace;
    expect(start).toMatchObject({ id: 'start', request: { method: 'POST', url: 'https://pf.example.test/as/bc-auth.ciba' } });
    expect(start.request.params).toEqual({ scope: 'openid', login_hint: 'demouser', binding_message: 'Approve-125' });
    expect(start.request.headers.Authorization).toMatch(/redacted/);
    expect(start.response.body.auth_req_id).toMatch(/^<redacted/);
    expect(start.response.body).toMatchObject({ expires_in: 120, interval: 3 });
    expect(JSON.stringify(view)).not.toContain(AUTH_REQ_ID);
    expect(JSON.stringify(view)).not.toContain(CLIENT_SECRET);
  });

  test('an approval adds the polling step, counts the earlier pending polls, and decodes the identity', async () => {
    const { request_ } = await started();
    const pending = jest.fn().mockResolvedValue(json({ error: 'authorization_pending' }, 400));
    for (let i = 0; i < 2; i += 1) {
      clock += 3_000;
      await pollCiba(request_, { store: makeStore(), fetchImpl: pending, now });
    }
    clock += 3_000;
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json({ id_token: idToken(), access_token: 'header.claims.signature-secret', token_type: 'Bearer', scope: 'openid', expires_in: 300 }))
      .mockResolvedValueOnce(json({ keys: [jwk] }));

    const result = await pollCiba(request_, { store: makeStore(), fetchImpl, now });

    expect(result.trace.map((step) => step.id)).toEqual(['start', 'poll']);
    const poll = result.trace[1];
    expect(poll.request.params.grant_type).toBe('urn:openid:params:grant-type:ciba');
    expect(poll.request.params.auth_req_id).toMatch(/^<redacted/);
    expect(poll.note).toBe('2 earlier polls answered authorization_pending while the user decided.');
    expect(poll.claims.idToken).toMatchObject({ sub: 'demouser', iss: 'https://pf.example.test' });
    expect(poll.response.body.access_token).toMatch(/^<redacted JWT/);
    const text = JSON.stringify(result);
    for (const secret of [AUTH_REQ_ID, CLIENT_SECRET, 'header.claims.signature-secret']) expect(text).not.toContain(secret);
  });

  test('a refusal shows the standard code and nothing else PingFederate said', async () => {
    const { request_ } = await started();
    clock += 3_000;
    const fetchImpl = jest.fn().mockResolvedValue(json({ error: 'access_denied', error_description: 'attacker-controlled text' }, 400));

    const result = await pollCiba(request_, { store: makeStore(), fetchImpl, now });

    expect(result.state).toBe('denied');
    expect(result.trace[1].response).toEqual({ status: 400, body: { error: 'access_denied' } });
    expect(JSON.stringify(result)).not.toContain('attacker-controlled');
  });

  test('an unrecognised error code is not echoed', async () => {
    const { request_ } = await started();
    clock += 3_000;
    const fetchImpl = jest.fn().mockResolvedValue(json({ error: 'expired_token' }, 400));

    const result = await pollCiba(request_, { store: makeStore(), fetchImpl, now });

    expect(result.trace[1].response.body).toEqual({ error: 'expired_token' });
  });

  test('the mock phone says plainly that nothing outside the page was involved', async () => {
    const request_ = req();
    const store = makeStore({ pf_ai_ciba_mock_enabled: 'true' });
    const view = await startCiba(request_, { loginHint: 'demouser', store, fetchImpl: jest.fn(), now });
    expect(view.trace[0].note).toMatch(/No PingFederate call is made/);

    const result = mockDecideCiba(request_, 'approve', { store, now });

    expect(result.trace.map((step) => step.id)).toEqual(['start', 'decision']);
    expect(result.trace[1].note).toMatch(/No token was issued/);
  });
});
