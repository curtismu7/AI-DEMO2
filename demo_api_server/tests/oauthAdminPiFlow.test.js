// Redirect-free admin sign-in: GET /login?pi_flow=1 + POST /pi-flow/{credentials,assertion,otp}
// on the admin router — mirrors tests/oauthUserPiFlow.test.js for routes/oauth.js.
// Gated by PINGONE_ADMIN_AUTHORIZE_PI_FLOW (off = 404 so the SPA keeps the redirect).
const request = require('supertest');
const express = require('express');
const session = require('express-session');

const configStore = require('../services/configStore');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    pingone_environment_id: 'test-env-id',
    admin_client_id: 'admin-client-id',
    admin_client_secret: 'admin-secret',
    admin_pingone_authorize_pi_flow: 'true',
    pf_admin_client_id: 'pf-admin-client',
  })[key]),
  isConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getAdminRedirectUri: jest.fn(() => 'https://local.ping-devops.com:4000/api/auth/oauth/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../data/store', () => ({ data: {}, get: () => ({}), set: () => {} }));
jest.mock('../middleware/auth', () => ({ determineClientType: jest.fn(() => 'admin') }));
jest.mock('../utils/oauthAuthorizeResource', () => ({
  buildPingOneAuthorizeResourceQueryParam: jest.fn(() => ''),
}));
jest.mock('../services/hostedAccessPolicy', () => ({
  loadHostedAccessPolicy: jest.fn(() => ({})),
  evaluateHostedIdentity: jest.fn(),
  coherentHostedIdentityClaims: jest.fn(),
  stampHostedAccessApproval: jest.fn(),
  clearHostedAccessApproval: jest.fn(),
}));

const json = (status, body, headers = {}, setCookies = []) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (h) => ({ 'content-type': 'application/json', ...headers })[h.toLowerCase()] ?? null,
    getSetCookie: () => setCookies,
  },
  json: async () => body,
});

describe('admin pi.flow sign-in', () => {
  let fetchMock;
  let app;

  beforeAll(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    const router = require('../routes/oauth');
    app = express();
    app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
    app.use(express.json());
    app.use('/api/auth/oauth', router);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    // The flag-off group needs the getter to return 'false'; the flag-on group
    // flips it back via this same mock.
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      admin_client_id: 'admin-client-id',
      admin_client_secret: 'admin-secret',
      admin_pingone_authorize_pi_flow: 'true',
      pf_admin_client_id: 'pf-admin-client',
    })[key]);
  });

  describe('flag off (default)', () => {
    test('GET /login?pi_flow=1 is still the plain redirect; the step endpoints 404', async () => {
      configStore.getEffective.mockImplementation((key) => ({
        pingone_environment_id: 'test-env-id',
        admin_client_id: 'admin-client-id',
        admin_client_secret: 'admin-secret',
        admin_pingone_authorize_pi_flow: 'false',
        pf_admin_client_id: 'pf-admin-client',
      })[key]);
      const res = await request(app).get('/api/auth/oauth/login?pi_flow=1').expect(302);
      expect(res.headers.location).not.toContain('response_mode=pi.flow');
      await request(app).post('/api/auth/oauth/pi-flow/credentials').send({ username: 'a', password: 'b' }).expect(404);
      await request(app).post('/api/auth/oauth/pi-flow/otp').send({ otp: '1' }).expect(404);
      await request(app).post('/api/auth/oauth/pi-flow/passwordless').send({ username: 'a' }).expect(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('flag on', () => {
    test('opens the flow with response_type=code + response_mode=pi.flow and returns JSON, not a redirect', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      const res = await request(app).get('/api/auth/oauth/login?pi_flow=1').expect(200);
      expect(res.body.flowId).toBe('aflow-1');
      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('response_mode')).toBe('pi.flow');
      // login_hint preserved (demoAdmin default) — the user asked for this explicitly.
      expect(url.searchParams.get('login_hint')).toBe('demoAdmin');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    test('plain /login is still a redirect without response_mode', async () => {
      const res = await request(app).get('/api/auth/oauth/login').expect(302);
      expect(res.headers.location).not.toContain('response_mode=pi.flow');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('force=true drops the login hint and sends prompt=login (a different admin can sign in)', async () => {
      const res = await request(app).get('/api/auth/oauth/login?force=true').expect(302);
      const url = new URL(res.headers.location);
      expect(url.searchParams.get('prompt')).toBe('login');
      expect(url.searchParams.get('login_hint')).toBeNull();
      expect(url.searchParams.get('response_mode')).toBeNull();
    });

    test('credentials step: COMPLETED -> resume -> callback URL carrying code and the session state', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=open; Path=/']));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock
        .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=second; Path=/']))
        .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'admin-code' } }));
      const res = await agent.post('/api/auth/oauth/pi-flow/credentials')
        .send({ username: 'demoAdmin', password: 'p' }).expect(200);
      const target = new URL(res.body.redirectTo);
      expect(target.pathname).toBe('/api/auth/oauth/callback');
      expect(target.searchParams.get('code')).toBe('admin-code');
      expect(target.searchParams.get('state')).toBeTruthy();
      const [postUrl, postInit] = fetchMock.mock.calls[1];
      expect(postUrl).toMatch(/\/flows\/aflow-1$/);
      expect(postInit.headers['Content-Type']).toBe('application/vnd.pingidentity.usernamePassword.check+json');
      expect(postInit.headers.Cookie).toBe('ST=open');
    });

    test('bad credentials -> 401 invalid_credentials', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'INVALID_CREDENTIALS' }] }));
      const res = await agent.post('/api/auth/oauth/pi-flow/credentials')
        .send({ username: 'demoAdmin', password: 'bad' }).expect(401);
      expect(res.body.error).toBe('invalid_credentials');
    });

    test('OTP_REQUIRED -> otp step -> COMPLETED resumes to the admin callback', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=open; Path=/']));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }, {}, ['ST=after-password; Path=/']));
      await agent.post('/api/auth/oauth/pi-flow/credentials').send({ username: 'demoAdmin', password: 'p' }).expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=after-otp; Path=/']));
      fetchMock.mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'admin-otp-code' } }));
      const res = await agent.post('/api/auth/oauth/pi-flow/otp').send({ otp: '654321' }).expect(200);
      expect(new URL(res.body.redirectTo).searchParams.get('code')).toBe('admin-otp-code');
      expect(fetchMock.mock.calls[2][1].headers['Content-Type']).toBe('application/vnd.pingidentity.otp.check+json');
    });

    test('a status the driver cannot handle still falls back so the SPA can redirect', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/pi-flow/credentials')
        .send({ username: 'demoAdmin', password: 'p' }).expect(200);
      expect(res.body).toEqual({ fallback: true, status: 'DEVICE_SELECTION_REQUIRED' });
    });

    test('passwordless start: username.check posts to the flow and returns the device step', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/pi-flow/passwordless')
        .send({ username: 'demoAdmin' }).expect(200);
      expect(res.body).toEqual({ step: 'otp' });
      expect(fetchMock.mock.calls[1][1].headers['Content-Type'])
        .toBe('application/vnd.pingidentity.username.check+json');
    });

    test('passwordless start: policy requires password -> 409 passwordless_unavailable', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await agent.get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'USERNAME_PASSWORD_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/pi-flow/passwordless')
        .send({ username: 'demoAdmin' }).expect(409);
      expect(res.body.error).toBe('passwordless_unavailable');
    });
  });
});
