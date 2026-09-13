'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/oauthService', () => ({
  // The app the flow's final node issues the widget ID token to.
  config: { clientId: 'client-1' },
  exchangeCodeForToken: jest.fn(),
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
}));

jest.mock('../../services/tokenVerificationService', () => ({
  verifyExchangedToken: jest.fn(),
}));

jest.mock('../../data/store', () => ({
  getUserByUsername: jest.fn(),
}));

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));
jest.mock('../../services/oauthEndpointResolver', () => ({
  getDiscoveryEndpoint: jest.fn(
    () => 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration'
  ),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const oauthService = require('../../services/oauthService');
const tokenVerificationService = require('../../services/tokenVerificationService');
const dataStore = require('../../data/store');
const davinciLoginRoutes = require('../../routes/davinciLogin');

// The callback enforces OIDC nonce replay verification: the session must carry
// the nonce armed by POST /sdk-token, and the ID token must echo it (see
// tests/davinciLoginNonce.test.js for the dedicated nonce suite). Tests here
// seed `davinciLoginNonce` and build a decodable ID token that echoes it.
const idTokenWithNonce = (nonce, claims = {}) =>
  'h.' + Buffer.from(JSON.stringify({ ...claims, nonce })).toString('base64url') + '.s';

function buildApp(sessionObj) {
  const app = express();
  app.use(express.json());
  if (sessionObj) {
    // Inject a persistent session object so tests can verify session state after the request.
    app.use((req, _res, next) => {
      req.session = sessionObj;
      req.session.regenerate = (cb) => cb(null);
      req.session.save = (cb) => cb && cb(null);
      next();
    });
  } else {
    app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
  }
  app.use('/api/davinci-login', davinciLoginRoutes);
  return app;
}

describe('POST /api/davinci-login/callback', () => {
  beforeEach(() => {
    oauthService.exchangeCodeForToken.mockReset();
    oauthService.getUserInfo.mockReset();
    oauthService.createUserFromOAuth.mockReset();
    dataStore.getUserByUsername.mockReset();
  });

  test('valid code exchanges tokens and establishes a session for an existing demo user', async () => {
    // Real oauthService.exchangeCodeForToken shape: raw PingOne token response
    // (snake_case), no `.claims` property.
    const idToken = idTokenWithNonce('nonce-1');
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-1',
      id_token: idToken,
      refresh_token: 'rt-1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u1', preferred_username: 'demoUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u1', username: 'demoUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue({ id: 'u1', username: 'demoUser', role: 'customer' });

    const session = { davinciLoginNonce: 'nonce-1' };
    const res = await request(buildApp(session))
      .post('/api/davinci-login/callback')
      .send({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith('code-1', 'verifier-1', 'https://local.ping-devops.com:4000/davinci-login/callback');
    expect(oauthService.getUserInfo).toHaveBeenCalledWith('at-1');
    expect(dataStore.getUserByUsername).toHaveBeenCalledWith('demoUser');

    // Verify session was established with correct tokens (from the real snake_case shape)
    // and the real user record from dataStore — not an invented `.claims` shape.
    expect(session.oauthTokens).toEqual({
      accessToken: 'at-1',
      idToken,
      refreshToken: 'rt-1',
      expiresAt: session.oauthTokens.expiresAt, // Use the actual value set by the handler
      tokenType: 'Bearer',
      scope: 'openid profile',
    });
    expect(session.user).toEqual({ id: 'u1', username: 'demoUser', role: 'customer' });
  });

  test('missing code is rejected', async () => {
    const res = await request(buildApp()).post('/api/davinci-login/callback').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  });

  test('a code without a body-supplied verifier is rejected — nothing is read off the session', async () => {
    const res = await request(buildApp({ davinciLoginNonce: 'n', davinciLoginCodeVerifier: 'stale' }))
      .post('/api/davinci-login/callback')
      .send({ code: 'c-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  test('unknown demo user is rejected, not auto-created', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-2',
      id_token: idTokenWithNonce('nonce-2'),
      refresh_token: 'rt-2',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u2', preferred_username: 'strangerUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u2', username: 'strangerUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue(null);

    const session = { davinciLoginNonce: 'nonce-2' };
    const res = await request(buildApp(session))
      .post('/api/davinci-login/callback')
      .send({ code: 'code-2', codeVerifier: 'verifier-2', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'user_not_found', message: 'No demo user found for "strangerUser".' });
    expect(session.oauthTokens).toBeUndefined();
    expect(session.user).toBeUndefined();
  });

  test('session regenerate failure aborts login', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-3',
      id_token: idTokenWithNonce('nonce-3'),
      refresh_token: 'rt-3',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u3', preferred_username: 'demoUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u3', username: 'demoUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue({ id: 'u3', username: 'demoUser', role: 'customer' });

    const app = express();
    app.use(express.json());
    const session = { davinciLoginNonce: 'nonce-3' };
    app.use((req, _res, next) => {
      req.session = session;
      req.session.regenerate = (cb) => cb(new Error('store unavailable'));
      req.session.save = (cb) => cb && cb(null);
      next();
    });
    app.use('/api/davinci-login', davinciLoginRoutes);

    const res = await request(app)
      .post('/api/davinci-login/callback')
      .send({ code: 'code-3', codeVerifier: 'verifier-3', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
    expect(session.oauthTokens).toBeUndefined();
    expect(session.user).toBeUndefined();
  });
});


// The widget flow's final node returns OIDC tokens to the page, which posts them
// here. They crossed the browser, so every check below must hold before a
// session exists — each test breaks exactly one.
describe('POST /api/davinci-login/widget-session', () => {
  const BODY = { idToken: 'id-w', accessToken: 'at-w' };
  const EXP = Math.floor(Date.now() / 1000) + 3600;
  const ID_CLAIMS = { sub: 'p1-user-1', aud: 'client-1', nonce: 'nonce-w' };
  const AT_CLAIMS = { sub: 'p1-user-1', aud: ['enduser.ping.demo'], exp: EXP, scope: 'openid profile email read write ai:agent:read' };
  const jwks = (claims) => ({ verified: true, fallbackMethod: 'jwks', claims, warning: null, error: null });
  let savedAudience;

  // Keyed by the raw token so a test can break one side only.
  function tokensVerifyAs(idResult, atResult) {
    tokenVerificationService.verifyExchangedToken.mockImplementation(async (token) =>
      (token === BODY.idToken ? idResult : atResult));
  }

  beforeEach(() => {
    tokenVerificationService.verifyExchangedToken.mockReset();
    oauthService.getUserInfo.mockReset().mockResolvedValue({ sub: 'p1-user-1', preferred_username: 'demoUser' });
    oauthService.createUserFromOAuth.mockReset().mockReturnValue({ username: 'demoUser' });
    dataStore.getUserByUsername.mockReset().mockReturnValue({ id: 'u1', username: 'demoUser', role: 'customer' });
    savedAudience = process.env.PINGONE_RESOURCE_BFF_URI;
    process.env.PINGONE_RESOURCE_BFF_URI = 'enduser.ping.demo';
  });
  afterEach(() => {
    if (savedAudience === undefined) delete process.env.PINGONE_RESOURCE_BFF_URI;
    else process.env.PINGONE_RESOURCE_BFF_URI = savedAudience;
  });

  test('verified tokens establish a session for an existing demo user and consume the nonce', async () => {
    tokensVerifyAs(jwks(ID_CLAIMS), jwks(AT_CLAIMS));
    const sess = { davinciLoginNonce: 'nonce-w' };

    const res = await request(buildApp(sess)).post('/api/davinci-login/widget-session').send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(tokenVerificationService.verifyExchangedToken).toHaveBeenCalledWith('id-w');
    expect(tokenVerificationService.verifyExchangedToken).toHaveBeenCalledWith('at-w');
    expect(oauthService.getUserInfo).toHaveBeenCalledWith('at-w');
    expect(sess.oauthTokens).toEqual({
      accessToken: 'at-w',
      idToken: 'id-w',
      refreshToken: null,
      expiresAt: EXP * 1000,
      tokenType: 'Bearer',
      scope: AT_CLAIMS.scope,
    });
    expect(sess.user).toEqual({ id: 'u1', username: 'demoUser', role: 'customer' });
    expect(sess.davinciLoginNonce).toBeUndefined();
  });

  test('400 with nothing verified when a token is missing', async () => {
    const res = await request(buildApp({ davinciLoginNonce: 'nonce-w' }))
      .post('/api/davinci-login/widget-session')
      .send({ idToken: 'id-w' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(tokenVerificationService.verifyExchangedToken).not.toHaveBeenCalled();
  });

  test('401 nonce_missing, with nothing verified, when this session armed no flow', async () => {
    const res = await request(buildApp({})).post('/api/davinci-login/widget-session').send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('nonce_missing');
    expect(tokenVerificationService.verifyExchangedToken).not.toHaveBeenCalled();
  });

  test('401 token_unverified when a signature fails — the verifier fails open, so verified:false must stop it', async () => {
    tokensVerifyAs(
      { verified: false, claims: null, warning: 'Signature invalid: invalid signature', error: null, fallbackMethod: 'jwks' },
      jwks(AT_CLAIMS),
    );
    const sess = { davinciLoginNonce: 'nonce-w' };

    const res = await request(buildApp(sess)).post('/api/davinci-login/widget-session').send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_unverified');
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
    expect(sess.user).toBeUndefined();
  });

  test('401 token_unverified when a token was only confirmed by introspection, not a JWKS signature', async () => {
    tokensVerifyAs(jwks(ID_CLAIMS), { ...jwks(AT_CLAIMS), fallbackMethod: 'introspection' });

    const res = await request(buildApp({ davinciLoginNonce: 'nonce-w' }))
      .post('/api/davinci-login/widget-session')
      .send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_unverified');
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
  });

  test('401 nonce_mismatch when the ID token echoes a different nonce, and the armed one is still spent', async () => {
    tokensVerifyAs(jwks({ ...ID_CLAIMS, nonce: 'attacker-nonce' }), jwks(AT_CLAIMS));
    const sess = { davinciLoginNonce: 'nonce-w' };

    const res = await request(buildApp(sess)).post('/api/davinci-login/widget-session').send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('nonce_mismatch');
    expect(sess.davinciLoginNonce).toBeUndefined();
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
  });

  test('401 audience_mismatch when the ID token was issued to another app', async () => {
    tokensVerifyAs(jwks({ ...ID_CLAIMS, aud: 'some-other-client' }), jwks(AT_CLAIMS));

    const res = await request(buildApp({ davinciLoginNonce: 'nonce-w' }))
      .post('/api/davinci-login/widget-session')
      .send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('audience_mismatch');
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
  });

  test('401 audience_mismatch when the access token is not for this API', async () => {
    tokensVerifyAs(jwks(ID_CLAIMS), jwks({ ...AT_CLAIMS, aud: ['https://api.pingone.com'] }));

    const res = await request(buildApp({ davinciLoginNonce: 'nonce-w' }))
      .post('/api/davinci-login/widget-session')
      .send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('audience_mismatch');
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
  });

  test('401 subject_mismatch when the two tokens name different users', async () => {
    tokensVerifyAs(jwks(ID_CLAIMS), jwks({ ...AT_CLAIMS, sub: 'p1-user-2' }));

    const res = await request(buildApp({ davinciLoginNonce: 'nonce-w' }))
      .post('/api/davinci-login/widget-session')
      .send(BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('subject_mismatch');
    expect(oauthService.getUserInfo).not.toHaveBeenCalled();
  });

  test('unknown demo user is rejected, not auto-created', async () => {
    tokensVerifyAs(jwks(ID_CLAIMS), jwks(AT_CLAIMS));
    dataStore.getUserByUsername.mockReturnValue(null);
    const sess = { davinciLoginNonce: 'nonce-w' };

    const res = await request(buildApp(sess)).post('/api/davinci-login/widget-session').send(BODY);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('user_not_found');
    expect(sess.oauthTokens).toBeUndefined();
  });
});


// POST /sdk-token mints the DaVinci SDK token that davinci.skRenderScreen needs.
// The DaVinci API key is a secret: it is sent upstream as X-SK-API-KEY and must
// never appear in the response. The nonce is bound to the session and passed to
// the flow as an input parameter (NOT returned), so the ID token
// /widget-session verifies is the one this request armed.
describe('POST /api/davinci-login/sdk-token', () => {
  const ENV = {
    PINGONE_DAVINCI_LOGIN_COMPANY_ID: 'co-1',
    PINGONE_DAVINCI_LOGIN_POLICY_ID_V1: 'pol-v1',
    PINGONE_DAVINCI_LOGIN_POLICY_ID_V2: 'pol-v2',
  };
  const saved = {};

  beforeEach(() => {
    axios.post.mockReset();
    // The API key is a vault secret: vaultLoader caches it into configStore
    // under the lowercased name, never into process.env.
    configStore.getEffective.mockReset().mockImplementation((k) =>
      k === 'pingone_davinci_api_key' ? 'sk-secret-key' : ''
    );
    Object.keys(ENV).forEach((k) => { saved[k] = process.env[k]; process.env[k] = ENV[k]; });
  });
  afterEach(() => {
    Object.keys(ENV).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  });

  test('mints a token with no username, binds the nonce to the session, and passes it to the flow', async () => {
    axios.post.mockResolvedValue({ data: { success: true, access_token: 'sdk-tok-1' } });
    const sess = {};

    // username is optional in the flow's Input Schema — the widget page sends
    // none, since the flow's own Sign On screen collects it.
    const res = await request(buildApp(sess)).post('/api/davinci-login/sdk-token');

    expect(res.status).toBe(200);
    // Widget config only. There is no authorize URL: sign-in completes from the
    // tokens the flow returns (POST /widget-session), not an /authorize redirect.
    expect(res.body).toEqual({
      accessToken: 'sdk-tok-1',
      companyId: 'co-1',
      policyId: 'pol-v1',
      flowVersion: 'v1',
      apiRoot: 'https://auth.pingone.com/',
    });

    // The nonce the flow was handed is the one now armed on the session — if
    // these ever diverge, /widget-session rejects every legitimate login.
    expect(sess.davinciLoginNonce).toMatch(/^[0-9a-f]{32}$/);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://orchestrate-api.pingone.com/v1/company/co-1/sdktoken');
    // username is declared optional in the flow's Input Schema — omitted
    // entirely rather than sent as an empty string, since DaVinci treats an
    // empty string as a value for the field, not as "not supplied".
    expect(body).toEqual({
      policyId: 'pol-v1',
      parameters: { nonce: sess.davinciLoginNonce },
    });
    expect(opts.headers['X-SK-API-KEY']).toBe('sk-secret-key');
  });

  test('includes username in parameters when the caller supplies one', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'sdk-tok-1' } });

    const res = await request(buildApp({})).post('/api/davinci-login/sdk-token').send({ username: 'demouser' });

    expect(res.status).toBe(200);
    expect(axios.post.mock.calls[0][1].parameters).toMatchObject({ username: 'demouser' });
  });

  test('never returns the DaVinci API key or the nonce to the browser', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'sdk-tok-1' } });
    const sess = {};

    const res = await request(buildApp(sess)).post('/api/davinci-login/sdk-token');

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('sk-secret-key');
    expect(sess.davinciLoginNonce).toMatch(/^[0-9a-f]{32}$/);
    expect(serialized).not.toContain(sess.davinciLoginNonce);
  });

  test('davinci_login_flow_version=v2 selects the v2 flow policy', async () => {
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'davinci_login_flow_version') return 'v2';
      if (k === 'pingone_davinci_api_key') return 'sk-secret-key';
      return '';
    });
    axios.post.mockResolvedValue({ data: { access_token: 'sdk-tok-2' } });

    const res = await request(buildApp({})).post('/api/davinci-login/sdk-token');

    expect(res.body.policyId).toBe('pol-v2');
    expect(res.body.flowVersion).toBe('v2');
    expect(axios.post.mock.calls[0][1].policyId).toBe('pol-v2');
  });

  test('503 with no upstream call when the vaulted API key never reached configStore', async () => {
    configStore.getEffective.mockReturnValue('');
    const sess = {};

    const res = await request(buildApp(sess)).post('/api/davinci-login/sdk-token');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('davinci_not_configured');
    // The message must name WHICH value is missing and where it lives — a
    // blanket "set these three" sent a real debugging session to the wrong file.
    expect(res.body.message).toContain('PINGONE_DAVINCI_API_KEY (vault)');
    expect(res.body.message).not.toContain('COMPANY_ID');
    expect(axios.post).not.toHaveBeenCalled();
    // Nothing armed, so a stray /widget-session still fails closed on nonce_missing.
    expect(sess.davinciLoginNonce).toBeUndefined();
  });

  test('502 when DaVinci responds without an access_token', async () => {
    axios.post.mockResolvedValue({ data: { success: false, httpResponseCode: 400 } });

    const res = await request(buildApp({})).post('/api/davinci-login/sdk-token');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('davinci_sdk_token_failed');
  });

  test('surfaces an upstream failure without leaking the API key', async () => {
    axios.post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 401, data: { message: 'bad key' } },
      })
    );

    const res = await request(buildApp({})).post('/api/davinci-login/sdk-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('davinci_sdk_token_failed');
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-key');
  });
});

describe('POST /api/davinci-login/sdk-token username validation', () => {
  const ENV2 = {
    PINGONE_DAVINCI_LOGIN_COMPANY_ID: 'co-1',
    PINGONE_DAVINCI_LOGIN_POLICY_ID_V1: 'pol-v1',
  };
  const saved2 = {};
  beforeEach(() => {
    axios.post.mockReset();
    configStore.getEffective.mockReset().mockImplementation((k) =>
      k === 'pingone_davinci_api_key' ? 'sk-secret-key' : ''
    );
    Object.keys(ENV2).forEach((k) => { saved2[k] = process.env[k]; process.env[k] = ENV2[k]; });
  });
  afterEach(() => {
    Object.keys(ENV2).forEach((k) => {
      if (saved2[k] === undefined) delete process.env[k]; else process.env[k] = saved2[k];
    });
  });

  test('a missing or blank username is fine — it is optional in the flow', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'sdk-tok' } });

    for (const body of [{}, { username: '   ' }]) {
      const res = await request(buildApp({})).post('/api/davinci-login/sdk-token').send(body);
      expect(res.status).toBe(200);
    }
  });

  test('400 with no upstream call when username is supplied but not a string', async () => {
    const res = await request(buildApp({}))
      .post('/api/davinci-login/sdk-token')
      .send({ username: { evil: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('400 with no upstream call when username exceeds the length cap', async () => {
    const res = await request(buildApp({}))
      .post('/api/davinci-login/sdk-token')
      .send({ username: 'x'.repeat(321) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
