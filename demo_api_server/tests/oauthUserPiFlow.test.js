// Redirect-free customer sign-in: /login?pi_flow=1 + POST /pi-flow/credentials.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const router = require('../routes/oauthUser');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    pingone_environment_id: 'test-env-id',
    user_client_id: 'test-client-id',
    user_client_secret: 'test-secret',
    user_pingone_authorize_pi_flow: 'true',
  })[key]),
  isUserOAuthConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getUserRedirectUri: jest.fn(() => 'https://api.ping.demo:4000/api/auth/oauth/user/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../utils/oauthAuthorizeResource', () => ({
  buildPingOneAuthorizeResourceQueryParam: jest.fn(() => ''),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const app = express();
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use('/api/auth/oauth/user', router);

const json = (status, body, headers = {}, setCookies = []) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (h) => ({ 'content-type': 'application/json', ...headers })[h.toLowerCase()] ?? null,
    getSetCookie: () => setCookies,
  },
  json: async () => body,
});

describe('customer pi.flow sign-in', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  async function openFlow(agent) {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    return agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
  }

  test('opens the flow with response_type=code + response_mode=pi.flow and returns JSON, not a redirect', async () => {
    const res = await openFlow(request.agent(app));
    expect(res.body).toEqual({ flowId: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('plain /login is still a redirect without response_mode', async () => {
    const res = await request(app).get('/api/auth/oauth/user/login').expect(302);
    expect(res.headers.location).not.toContain('response_mode=pi.flow');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('502 when PingOne does not open a flow, so the SPA can fall back to the redirect login', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { code: 'INVALID_REQUEST' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(502);
    expect(res.body.error).toBe('pi_flow_unavailable');
  });

  test('credentials step: COMPLETED -> resume -> callback URL carrying code and the session state', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'the-code' } }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    const target = new URL(res.body.redirectTo);
    expect(target.pathname).toBe('/api/auth/oauth/user/callback');
    expect(target.searchParams.get('code')).toBe('the-code');
    expect(target.searchParams.get('state')).toBeTruthy();
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toMatch(/\/flows\/flow-1$/);
    expect(postInit.headers['Content-Type']).toBe('application/vnd.pingidentity.usernamePassword.check+json');
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/as\/resume\?flowId=flow-1$/);
  });

  test('replays the ST cookie issued by the password step on /as/resume (PingOne rejects a stale one)', async () => {
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=first; Path=/; HttpOnly']));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=second; Path=/; HttpOnly']))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('ST=first');
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toBe('ST=second');
  });

  test('bad password -> 401 invalid_credentials', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'INVALID_CREDENTIALS' }] }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'bad' }).expect(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  test('a flow that needs more than a password returns fallback instead of resuming', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body).toEqual({ fallback: true, status: 'OTP_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('credentials without an open flow -> 409, PingOne never called', async () => {
    await request(app).post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
