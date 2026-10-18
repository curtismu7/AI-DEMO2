// Park the finished password flow when a CIBA second factor is requested.
const request = require('supertest');
const express = require('express');
const session = require('express-session');

let mockFlags = { ciba_login_enabled: 'true' };
let mockProvider = 'pingone';
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in mockFlags ? mockFlags[key] : ({
    pingone_environment_id: 'test-env-id',
    user_client_id: 'test-client-id',
    user_client_secret: 'test-secret',
    user_pingone_authorize_pi_flow: 'true',
    pf_authorization_endpoint: 'https://pf.example:9031/as/authorization.oauth2',
    pf_token_endpoint: 'https://pingfederate.internal:9031/as/token.oauth2',
    pf_user_client_id: 'pf-client',
  })[key])),
  isUserOAuthConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => mockProvider),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getUserRedirectUri: jest.fn(() => 'https://api.ping.demo:4000/api/auth/oauth/user/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../utils/oauthAuthorizeResource', () => ({ buildPingOneAuthorizeResourceQueryParam: jest.fn(() => '') }));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserById: jest.fn(),
  fetchPingOneUserByUsername: jest.fn(),
  resolvePingOneIdentifier: jest.fn(),
}));

const lookup = require('../services/pingOneUserLookupService');
const authCookie = require('../services/authStateCookie');
const router = require('../routes/oauthUser');
const { makePiFlowHandlers } = require('../services/piFlowDriver');
const oauthUserConfig = require('../config/oauthUser');

const { piFlowHandlers } = router;
const adminHandlers = makePiFlowHandlers({ providerConfig: oauthUserConfig, knownRedirectOrigins: [] });

const app = express();
const store = new session.MemoryStore();
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true, store }));
app.use(express.json());
app.use('/api/auth/oauth/user', router);
app.post('/t/admin-credentials', adminHandlers.handleCredentialsStep);
app.get('/t/parked', (req, res) => res.json({ parked: piFlowHandlers.getParkedFlow(req) }));
app.get('/t/session', (req, res) => res.json({
  parked: !!req.session.oauthPiFlowParked, open: !!req.session.oauthPiFlow, tokens: !!req.session.oauthTokens, user: !!req.session.user,
}));
app.post('/t/complete', async (req, res) => res.json(await piFlowHandlers.completeParkedFlow(req)));

const json = (status, body, setCookies = []) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null), getSetCookie: () => setCookies },
  json: async () => body,
});
const USER = { id: 'p1-user-id', username: 'demoUser', email: 'a@b.test', mobilePhone: '+15551230000', enabled: true };
const CREDS = '/api/auth/oauth/user/pi-flow/credentials';

describe('pi.flow CIBA second factor parking', () => {
  let fetchMock;
  beforeEach(() => {
    mockFlags = { ciba_login_enabled: 'true' };
    mockProvider = 'pingone';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    authCookie.setAuthCookie.mockClear();
    lookup.resolvePingOneIdentifier.mockReset().mockResolvedValue({ user: USER, error: null });
    lookup.fetchPingOneUserByUsername.mockReset().mockResolvedValue({ user: USER, error: null });
  });

  async function open(agent, status = 'USERNAME_PASSWORD_REQUIRED') {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status }));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
  }
  const sess = (agent) => agent.get('/t/session').then((r) => r.body);
  async function parkedAgent() {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }));
    await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    return agent;
  }

  test('(a) PingOne: parks, answers approval, no redirect/cookie/resume, no tokens', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }));
    const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res.body).toEqual({ step: 'approval', channels: ['email', 'sms'] });
    expect(res.body.redirectTo).toBeUndefined();
    expect((res.headers['set-cookie'] || []).join(';')).not.toMatch(/auth|token/i);
    expect(authCookie.setAuthCookie).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((c) => /\/as\/resume/.test(String(c[0])))).toBe(false);
    expect(lookup.fetchPingOneUserByUsername).toHaveBeenCalledWith('demoUser');
    expect(lookup.resolvePingOneIdentifier).not.toHaveBeenCalled();
    expect(await sess(agent)).toEqual({ parked: true, open: false, tokens: false, user: false });
  });

  test('(b) PingFederate: inline authorizeResponse, user mapped via username; no PingOne account -> today\'s redirect', async () => {
    mockProvider = 'pingfederate';
    const pfDone = (state) => json(200, { status: 'COMPLETED', authorizeResponse: { code: 'pf-code', state } });
    let agent = request.agent(app);
    await open(agent, 'USERNAME_PASSWORD_REQUIRED');
    fetchMock.mockResolvedValueOnce(pfDone(undefined));
    let res = await agent.post(CREDS).send({ username: 'demouser', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res.body).toEqual({ step: 'approval', channels: ['email', 'sms'] });
    expect(lookup.fetchPingOneUserByUsername).toHaveBeenCalledWith('demouser');
    expect(lookup.resolvePingOneIdentifier).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('pf-code');
    const done = await agent.post('/t/complete').expect(200);
    expect(new URL(done.body.redirectTo).searchParams.get('code')).toBe('pf-code');

    lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
    agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(pfDone(undefined));
    res = await agent.post(CREDS).send({ username: 'nobody', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(new URL(res.body.redirectTo).searchParams.get('code')).toBe('pf-code');
    expect(res.body.secondFactorSkipped).toBe(true);
    expect((await sess(agent)).parked).toBe(false);
  });

  test('(c) wrong password 401 parks nothing', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'INVALID_CREDENTIALS' }] }));
    await agent.post(CREDS).send({ username: 'u', password: 'bad', secondFactor: 'ciba' }).expect(401);
    expect((await sess(agent)).parked).toBe(false);
    expect(lookup.resolvePingOneIdentifier).not.toHaveBeenCalled();
  });

  test('(d) a non-COMPLETED status parks nothing and behaves as today', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED', _embedded: { devices: [] } }));
    const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res.body.step).toBe('device');
    expect(await sess(agent)).toEqual({ parked: false, open: true, tokens: false, user: false });
    fetchMock.mockResolvedValueOnce(json(200, { status: 'SOMETHING_ELSE' }));
    const res2 = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res2.body).toEqual({ fallback: true, status: 'SOMETHING_ELSE', secondFactorSkipped: true });
    expect((await sess(agent)).parked).toBe(false);
  });

  describe('(e) unchanged when not requested', () => {
    const redirects = async (post) => {
      const agent = request.agent(app);
      await open(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
        .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c1' } }));
      const res = await post(agent).expect(200);
      expect(new URL(res.body.redirectTo).searchParams.get('code')).toBe('c1');
      expect((await sess(agent)).parked).toBe(false);
    };
    test('flag off', async () => {
      mockFlags = { ciba_login_enabled: 'false' };
      await redirects((a) => a.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }));
    });
    test('flag unset', async () => {
      mockFlags = { ciba_login_enabled: undefined };
      await redirects((a) => a.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }));
    });
    test('secondFactor absent', async () => {
      await redirects((a) => a.post(CREDS).send({ username: 'u', password: 'p' }));
    });
    test('handlers built without allowSecondFactor (admin)', async () => {
      await redirects((a) => a.post('/t/admin-credentials').send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }));
    });
  });

  test('(e2) fallback response is byte-identical when the factor is not requested', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'SOMETHING_ELSE' }));
    const res = await agent.post(CREDS).send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body).toEqual({ fallback: true, status: 'SOMETHING_ELSE' });
    mockFlags = { ciba_login_enabled: 'false' };
    fetchMock.mockResolvedValueOnce(json(200, { status: 'SOMETHING_ELSE' }));
    const res2 = await agent.post(CREDS).send({ username: 'u', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res2.body).toEqual({ fallback: true, status: 'SOMETHING_ELSE' });
  });

  test('(f) getParkedFlow returns null and clears after 150 s', async () => {
    const agent = await parkedAgent();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(now + 149_000);
    expect((await agent.get('/t/parked')).body.parked).toEqual({ expectedSub: 'p1-user-id', username: 'demoUser', user: USER });
    spy.mockReturnValue(now + 151_000);
    expect((await agent.get('/t/parked')).body.parked).toBeNull();
    spy.mockRestore();
    expect((await sess(agent)).parked).toBe(false);
  });

  test('(g) completeParkedFlow is single-use; errors without parked state', async () => {
    const fresh = request.agent(app);
    const none = await fresh.post('/t/complete').expect(200);
    expect(none.body.error).toBeTruthy();
    expect(none.body.redirectTo).toBeUndefined();

    const agent = await parkedAgent();
    fetchMock.mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'once' } }));
    const first = await agent.post('/t/complete').expect(200);
    expect(new URL(first.body.redirectTo).searchParams.get('code')).toBe('once');
    const second = await agent.post('/t/complete').expect(200);
    expect(second.body.error).toBeTruthy();
    expect(second.body.redirectTo).toBeUndefined();
  });

  test('(g2) a failed completion still burns the parked state', async () => {
    const agent = await parkedAgent();
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const first = await agent.post('/t/complete').expect(200);
    expect(first.body.error).toBeTruthy();
    expect((await sess(agent)).parked).toBe(false);
  });

  test('(h) channels reflect the user; contactless users are not parked', async () => {
    const run = async (user, expectChannels) => {
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user, error: null });
      fetchMock.mockReset();
      const agent = request.agent(app);
      await open(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
        .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
      const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
      if (expectChannels) expect(res.body.channels).toEqual(expectChannels);
      else expect(res.body.redirectTo).toBeTruthy();
      expect((await sess(agent)).parked).toBe(!!expectChannels);
    };
    await run({ ...USER, mobilePhone: '' }, ['email']);
    await run({ ...USER, email: '' }, ['sms']);
    await run({ ...USER, email: '', mobilePhone: '' }, null);
  });

  test('(h2) no-contact user completes normally with secondFactorSkipped', async () => {
    lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: { ...USER, email: '', mobilePhone: '' }, error: null });
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    expect(res.body.redirectTo).toBeTruthy();
    expect(res.body.secondFactorSkipped).toBe(true);
    expect((await sess(agent)).parked).toBe(false);
  });

  test('(h3) completion without the factor requested carries no marker', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p' }).expect(200);
    expect(Object.keys(res.body)).toEqual(['redirectTo']);
  });

  test('(i) parked state never reaches the browser', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'SECRET-CODE' } }, ['ST=SECRET-ST; Path=/']));
    const res = await agent.post(CREDS).send({ username: 'demoUser', password: 'p', secondFactor: 'ciba' }).expect(200);
    const wire = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(Object.keys(res.body).sort()).toEqual(['channels', 'step']);
    expect(wire).not.toMatch(/SECRET|flow-1|pending|cookies|p1-user-id/);
    expect((await agent.get('/t/parked')).text).not.toMatch(/SECRET|flow-1/);
  });

  describe('fail closed', () => {
    const attempt = async (typed) => {
      fetchMock.mockReset();
      const agent = request.agent(app);
      await open(agent);
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'x' } }))
        .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'x' } }));
      const res = await agent.post(CREDS).send({ username: typed, password: 'p', secondFactor: 'ciba' });
      return { agent, res };
    };
    const closed = async ({ agent, res }) => {
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: 'approval_unavailable' });
      expect(fetchMock.mock.calls.some((c) => /\/as\/resume/.test(String(c[0])))).toBe(false);
      expect(authCookie.setAuthCookie).not.toHaveBeenCalled();
      expect((await sess(agent)).parked).toBe(false);
    };
    test('PingOne lookup error -> 502, nothing completed', async () => {
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'request_failed' });
      await closed(await attempt('demoUser'));
    });
    test('PingOne email-typed lookup error -> 502', async () => {
      lookup.resolvePingOneIdentifier.mockResolvedValue({ user: null, error: 'request_failed' });
      await closed(await attempt('a@b.test'));
    });
    test('PingOne not_found -> 502', async () => {
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
      await closed(await attempt('demoUser'));
    });
    test('PF lookup error (not not_found) -> 502', async () => {
      mockProvider = 'pingfederate';
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'request_failed' });
      await closed(await attempt('demoUser'));
    });
    test('typed value equal to another user\'s id -> 502, not parked', async () => {
      // username-only lookup finds nothing for a UUID typed as the username
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
      await closed(await attempt('11111111-2222-3333-4444-555555555555'));
      expect(lookup.resolvePingOneIdentifier).not.toHaveBeenCalled();
    });
    test('resolved user whose username/email does not match the typed value -> 502', async () => {
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: { ...USER, username: 'someoneElse' }, error: null });
      await closed(await attempt('demoUser'));
      lookup.resolvePingOneIdentifier.mockResolvedValue({ user: { ...USER, username: 'someoneElse', email: 'other@b.test' }, error: null });
      await closed(await attempt('a@b.test'));
    });
    test('disabled user -> 502, nothing completed', async () => {
      lookup.fetchPingOneUserByUsername.mockResolvedValue({ user: { ...USER, enabled: false }, error: null });
      await closed(await attempt('demoUser'));
    });
    test('exact, case-different and email-typed logins park', async () => {
      for (const typed of ['demoUser', ' DEMOUSER ']) {
        const { res } = await attempt(typed);
        expect(res.body.step).toBe('approval');
      }
      lookup.resolvePingOneIdentifier.mockResolvedValue({ user: USER, error: null });
      const { res } = await attempt('A@B.test');
      expect(res.body.step).toBe('approval');
      expect(lookup.resolvePingOneIdentifier).toHaveBeenCalledWith('A@B.test');
    });
  });

  test('a failed session save fails closed when finishing a parked flow', async () => {
    const agent = await parkedAgent();
    const origSet = store.set.bind(store);
    store.set = (sid, sess2, cb) => cb(new Error('store down'));
    try {
      const res = await agent.post('/t/complete').expect(200);
      expect(res.body).toEqual({ status: 502, error: 'approval_unavailable' });
      expect(res.body.redirectTo).toBeUndefined();
    } finally {
      store.set = origSet;
    }
  });

  test('starting a new pi.flow login discards a parked flow', async () => {
    const agent = await parkedAgent();
    expect((await sess(agent)).parked).toBe(true);
    await open(agent);
    expect((await sess(agent)).parked).toBe(false);
  });
});
