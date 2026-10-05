'use strict';

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { startCiba, pollCiba } = require('../services/pfAiAgentCibaService');
const { createPfAiAgentRouter } = require('../routes/pfAiAgent');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const CLIENT_ID = 'ai-demo-pf-ciba';
const CLIENT_SECRET = 'ciba-client-secret-value';
const BACKCHANNEL = 'https://pf.example.test/as/bc-auth.ciba';
const TOKEN_ENDPOINT = 'https://pf.example.test/as/token.oauth2';

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
    pf_token_endpoint: TOKEN_ENDPOINT,
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const discovery = (extra = {}) => json({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  backchannel_authentication_endpoint: BACKCHANNEL,
  ...extra,
});
const accepted = (extra = {}) => json({ auth_req_id: 'auth-req-secret-id', expires_in: 120, interval: 3, ...extra });
const idToken = () => jwt.sign(
  { sub: 'demouser', iss: 'https://pf.example.test', aud: CLIENT_ID },
  privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 },
);
const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
const req = (extra = {}) => ({ session: { user: { username: 'demouser' }, ...extra } });

let clock;
const now = () => clock;
beforeEach(() => { clock = 1_700_000_000_000; });

describe('starting a CIBA approval', () => {
  test('sends the backchannel request with client authentication and keeps the auth_req_id server-side', async () => {
    const request_ = req();
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted());

    const view = await startCiba(request_, { loginHint: 'demouser', bindingMessage: 'Transfer-125-USD', store: makeStore(), fetchImpl, now });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe(BACKCHANNEL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(basic);
    expect(Object.fromEntries(init.body)).toEqual({ scope: 'openid', login_hint: 'demouser', binding_message: 'Transfer-125-USD' });
    expect(view).toEqual({
      state: 'pending', expiresAt: new Date(clock + 120_000).toISOString(), interval: 3,
      loginHint: 'demouser', bindingMessage: 'Transfer-125-USD',
    });
    expect(JSON.stringify(view)).not.toContain('auth-req-secret-id');
    expect(request_.session.pfAiAgent.cibaPending.authReqId).toBe('auth-req-secret-id');
  });

  test('asks for the signed-in user when no name is given, and sends no binding message', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted());
    await startCiba(req(), { store: makeStore(), fetchImpl, now });
    expect(Object.fromEntries(fetchImpl.mock.calls[1][1].body)).toEqual({ scope: 'openid', login_hint: 'demouser' });
  });

  test.each([
    ['a message with markup', { bindingMessage: '<script>x</script>' }, 'PF_AI_CIBA_BINDING_MESSAGE_INVALID'],
    ['a message that is too long', { bindingMessage: 'a'.repeat(21) }, 'PF_AI_CIBA_BINDING_MESSAGE_INVALID'],
    ['a user name with a control character', { loginHint: 'demo\nuser' }, 'PF_AI_CIBA_USER_REQUIRED'],
    ['a user name that is too long', { loginHint: 'u'.repeat(257) }, 'PF_AI_CIBA_USER_REQUIRED'],
  ])('refuses %s before calling PingFederate', async (_label, input, code) => {
    const fetchImpl = jest.fn();
    await expect(startCiba(req(), { ...input, store: makeStore(), fetchImpl, now }))
      .rejects.toMatchObject({ code, httpStatus: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('has no user to ask for when there is no name and no session user', async () => {
    await expect(startCiba({ session: {} }, { store: makeStore(), fetchImpl: jest.fn(), now }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_USER_REQUIRED' });
  });

  test.each([
    ['an unknown user', json({ error: 'unknown_user_id' }, 400), 'PF_AI_CIBA_USER_UNKNOWN', 404],
    ['a rejected client', json({ error: 'invalid_client' }, 401), 'PF_AI_CIBA_CLIENT_REJECTED', 502],
    ['any other refusal', json({ error: 'invalid_scope' }, 400), 'PF_AI_CIBA_REQUEST_FAILED', 502],
  ])('maps %s to its own code', async (_label, response, code, httpStatus) => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(response);
    await expect(startCiba(req(), { store: makeStore(), fetchImpl, now })).rejects.toMatchObject({ code, httpStatus });
  });

  test('reports PingFederate being unreachable', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(startCiba(req(), { store: makeStore(), fetchImpl, now })).rejects.toMatchObject({ code: 'PF_AI_CIBA_UNREACHABLE' });
  });

  test('allows one pending request at a time, until it expires', async () => {
    const request_ = req();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted({ auth_req_id: 'second-id' }));
    await startCiba(request_, { store: makeStore(), fetchImpl, now });
    await expect(startCiba(request_, { store: makeStore(), fetchImpl, now }))
      .rejects.toMatchObject({ code: 'PF_AI_FLOW_ALREADY_PENDING', httpStatus: 409 });

    clock += 121_000;
    await startCiba(request_, { store: makeStore(), fetchImpl, now });
    expect(request_.session.pfAiAgent.cibaPending.authReqId).toBe('second-id');
  });

  test('refuses when CIBA is off or incomplete, and when PingFederate does not advertise it', async () => {
    const fetchImpl = jest.fn();
    for (const overrides of [{ pf_ai_ciba_enabled: 'false' }, { pf_ai_ciba_client_secret: '' }, { pf_ai_ciba_client_id: '' }]) {
      await expect(startCiba(req(), { store: makeStore(overrides), fetchImpl, now }))
        .rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_CONFIGURED', httpStatus: 503 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    const unsupported = jest.fn().mockResolvedValueOnce(discovery({ backchannel_authentication_endpoint: undefined }));
    await expect(startCiba(req(), { store: makeStore(), fetchImpl: unsupported, now }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_NOT_SUPPORTED' });
  });

  test('bounds the lifetime and the polling interval PingFederate asks for', async () => {
    const long = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted({ expires_in: 99_999, interval: 0 }));
    const view = await startCiba(req(), { store: makeStore(), fetchImpl: long, now });
    expect(view.interval).toBe(1);
    expect(Date.parse(view.expiresAt)).toBe(clock + 5 * 60 * 1000);

    const slow = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted({ interval: 9999 }));
    expect((await startCiba(req(), { store: makeStore(), fetchImpl: slow, now })).interval).toBe(30);
  });
});

describe('polling a CIBA approval', () => {
  async function pendingRequest(interval = 3) {
    const request_ = req();
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted({ interval }));
    await startCiba(request_, { store: makeStore(), fetchImpl, now });
    return request_;
  }

  test('has nothing to report before a request is started', async () => {
    expect(await pollCiba(req(), { store: makeStore(), fetchImpl: jest.fn(), now })).toEqual({ state: 'none' });
  });

  test('does not call PingFederate faster than its interval, and sends the CIBA grant when it does', async () => {
    const request_ = await pendingRequest(3);
    const fetchImpl = jest.fn().mockResolvedValue(json({ error: 'authorization_pending' }, 400));

    clock += 3_000;
    expect((await pollCiba(request_, { store: makeStore(), fetchImpl, now })).state).toBe('pending');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init.headers.Authorization).toBe(basic);
    expect(Object.fromEntries(init.body)).toEqual({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: 'auth-req-secret-id' });

    clock += 1_000; // too soon: answered from the session
    expect((await pollCiba(request_, { store: makeStore(), fetchImpl, now })).state).toBe('pending');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 2_000;
    await pollCiba(request_, { store: makeStore(), fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('slows down when PingFederate says so', async () => {
    const request_ = await pendingRequest(3);
    clock += 3_000;
    const view = await pollCiba(request_, { store: makeStore(), fetchImpl: jest.fn().mockResolvedValue(json({ error: 'slow_down' }, 400)), now });
    expect(view).toMatchObject({ state: 'pending', interval: 8 });
  });

  test.each([
    ['access_denied', 'denied', 'user_denied'],
    ['expired_token', 'expired', 'timed_out'],
  ])('records %s as %s and stops polling', async (error, state, reason) => {
    const request_ = await pendingRequest();
    clock += 3_000;
    const fetchImpl = jest.fn().mockResolvedValue(json({ error }, 400));
    expect(await pollCiba(request_, { store: makeStore(), fetchImpl, now })).toMatchObject({ state, reason });
    expect(request_.session.pfAiAgent.cibaPending).toBeUndefined();

    clock += 10_000; // later polls report the stored result without calling PingFederate
    expect((await pollCiba(request_, { store: makeStore(), fetchImpl, now })).state).toBe(state);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('stops and reports an error when PingFederate answers with something unexpected', async () => {
    const request_ = await pendingRequest();
    clock += 3_000;
    await expect(pollCiba(request_, { store: makeStore(), now, fetchImpl: jest.fn().mockResolvedValue(json({ error: 'server_error' }, 500)) }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_POLL_FAILED' });
    expect(request_.session.pfAiAgent.cibaPending).toBeUndefined();
    expect(request_.session.pfAiAgent.cibaResult).toMatchObject({ state: 'error', reason: 'poll_failed' });
  });

  test('expires by the clock without asking PingFederate', async () => {
    const request_ = await pendingRequest();
    clock += 121_000;
    const fetchImpl = jest.fn();
    expect(await pollCiba(request_, { store: makeStore(), fetchImpl, now })).toMatchObject({ state: 'expired', reason: 'timed_out' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('on approval verifies the ID token and reports only safe metadata', async () => {
    const request_ = await pendingRequest();
    clock += 3_000;
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json({ id_token: idToken(), access_token: 'at-secret-value', token_type: 'Bearer', scope: 'openid', expires_in: 300 }))
      .mockResolvedValueOnce(json({ keys: [jwk] }));

    const result = await pollCiba(request_, { store: makeStore(), fetchImpl, now });

    expect(result).toMatchObject({
      state: 'approved', loginHint: 'demouser', subject: 'demouser', issuer: 'https://pf.example.test', scope: 'openid', tokenType: 'Bearer',
    });
    expect(JSON.stringify(result)).not.toMatch(/at-secret-value|auth-req-secret-id|ciba-client-secret-value|eyJ/);
    expect(request_.session.pfAiAgent.cibaPending).toBeUndefined();
    expect(request_.session.pfAiAgent.cibaResult).toEqual(result);
  });

  test('does not accept an approval whose ID token is for another audience', async () => {
    const request_ = await pendingRequest();
    clock += 3_000;
    const wrong = jwt.sign({ sub: 'demouser', iss: 'https://pf.example.test', aud: 'someone-else' },
      privateKey, { algorithm: 'RS256', keyid: 'pf-key', expiresIn: 300 });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json({ id_token: wrong, access_token: 'at', token_type: 'Bearer' }))
      .mockResolvedValueOnce(json({ keys: [jwk] }));
    await expect(pollCiba(request_, { store: makeStore(), fetchImpl, now })).rejects.toMatchObject({ code: 'PF_AI_ID_TOKEN_INVALID' });
  });
});

describe('CIBA routes', () => {
  const appWith = (session, fetchImpl, store = makeStore()) => {
    const app = express();
    app.use(express.json());
    app.use((request_, _res, next) => { request_.session = session; next(); });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store, fetchImpl, dataStore: {} }));
    return app;
  };
  const signedIn = () => ({ oauthProvider: 'pingone', oauthTokens: { accessToken: 't' }, user: { username: 'demouser' } });

  test('start and status need an application session', async () => {
    const app = appWith({}, jest.fn());
    await request(app).post('/api/pf-ai-agent/ciba/start').send({}).expect(401);
    await request(app).get('/api/pf-ai-agent/ciba/status').expect(401);
  });

  test('start answers with the pending view and no-store, never the auth_req_id', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(accepted());
    const response = await request(appWith(signedIn(), fetchImpl))
      .post('/api/pf-ai-agent/ciba/start').send({ loginHint: 'demouser', bindingMessage: 'Approve-transfer' }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ state: 'pending', loginHint: 'demouser' });
    expect(JSON.stringify(response.body)).not.toContain('auth-req-secret-id');
  });

  test('turns service errors into their code and status', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(json({ error: 'unknown_user_id' }, 400));
    const response = await request(appWith(signedIn(), fetchImpl)).post('/api/pf-ai-agent/ciba/start').send({}).expect(404);
    expect(response.body).toEqual({ error: 'PF_AI_CIBA_USER_UNKNOWN' });
    const bad = await request(appWith(signedIn(), jest.fn())).post('/api/pf-ai-agent/ciba/start').send({ bindingMessage: '<b>' }).expect(400);
    expect(bad.body).toEqual({ error: 'PF_AI_CIBA_BINDING_MESSAGE_INVALID' });
  });

  test('status reports none before anything is started', async () => {
    const response = await request(appWith(signedIn(), jest.fn())).get('/api/pf-ai-agent/ciba/status').expect(200);
    expect(response.body).toEqual({ state: 'none' });
  });
});
