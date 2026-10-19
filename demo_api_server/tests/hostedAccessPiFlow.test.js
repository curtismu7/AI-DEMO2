// Front-door pi.flow: the hosted-access login can open and drive a PingOne pi.flow instead of redirecting.
// The authorization code must still come back through the UNCHANGED /callback (where the allowlist decides).
const request = require('supertest');
const express = require('express');
const session = require('express-session');

process.env.HOSTED_ACCESS_CLIENT_ID = 'front-door-client';
process.env.HOSTED_ACCESS_REDIRECT_URI = 'https://ai-demo.example/api/auth/hosted-access/callback';

jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn(() => undefined),
}));
jest.mock('../services/oauthEndpointResolver', () => ({
  getAuthorizationEndpoint: () => 'https://auth.pingone.com/env1/as/authorize',
  getTokenEndpoint: () => 'https://auth.pingone.com/env1/as/token',
  getUserInfoEndpoint: () => 'https://auth.pingone.com/env1/as/userinfo',
  getIssuer: () => 'https://auth.pingone.com/env1/as',
  getJwksUri: () => 'https://auth.pingone.com/env1/as/jwks',
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'https://ai-demo.example'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
}));
jest.mock('../services/hostedAccessPolicy', () => ({
  loadHostedAccessPolicy: jest.fn(() => ({ enabled: true, rejectPlusAddressing: false, allowedIdentifiers: [] })),
  evaluateHostedIdentity: jest.fn(),
  coherentHostedIdentityClaims: jest.fn(),
  stampHostedAccessApproval: jest.fn(),
}));
jest.mock('../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(), resumeLoginAudit: jest.fn(), finishLoginAudit: jest.fn(),
}));
jest.mock('../services/pingOneUserLookupService', () => ({ resolvePingOneIdentifier: jest.fn() }));

const configStore = require('../services/configStore');
const router = require('../routes/hostedAccess');

const app = express();
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
app.use((req, _res, next) => { req.hostedSession = req.session; next(); });
app.use(express.json());
app.use('/api/auth/hosted-access', router);

const json = (status, body, setCookies = []) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => 'application/json', getSetCookie: () => setCookies },
  json: async () => body,
});

describe('front-door pi.flow', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    configStore.getOAuthProvider.mockReturnValue('pingone');
  });
  const open = async (agent) => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-fd1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    return agent.get('/api/auth/hosted-access/login?pi_flow=1&return_to=/mfa-test').expect(200);
  };

  test('login?pi_flow=1 opens a pi.flow with the front-door client and answers JSON, not a redirect', async () => {
    const res = await open(request.agent(app));
    expect(res.body).toEqual({ flowId: 'flow-fd1', status: 'USERNAME_PASSWORD_REQUIRED' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('client_id')).toBe('front-door-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://ai-demo.example/api/auth/hosted-access/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('login without pi_flow still redirects to the hosted page', async () => {
    const res = await request(app).get('/api/auth/hosted-access/login?return_to=/mfa-test');
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('response_mode')).toBeNull();
  });

  test('a finished password flow hands the browser to the hosted /callback with code + the stored state', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce({ ...json(302, {}), headers: { get: (h) => (h === 'location' ? 'https://ai-demo.example/cb?code=abc123' : null), getSetCookie: () => [] } });
    const res = await agent.post('/api/auth/hosted-access/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    const target = new URL(res.body.redirectTo);
    expect(`${target.origin}${target.pathname}`).toBe('https://ai-demo.example/api/auth/hosted-access/callback');
    expect(target.searchParams.get('code')).toBe('abc123');
    expect(target.searchParams.get('state')).toMatch(/^[a-f0-9]{16,}$/);
  });

  test('wrong credentials stay a 401 (status code is not swallowed)', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'INVALID_CREDENTIALS' }] }));
    await agent.post('/api/auth/hosted-access/pi-flow/credentials').send({ username: 'u', password: 'bad' }).expect(401);
  });

  test('an MFA step is not driven here: answers fallback so the SPA uses the hosted page', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED', _embedded: { devices: [] } }));
    const res = await agent.post('/api/auth/hosted-access/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body).toEqual({ fallback: true, status: 'otp' });
  });

  test('credentials without an opened flow are refused', async () => {
    await request(app).post('/api/auth/hosted-access/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(409);
  });

  test('PingFederate provider: pi.flow is unavailable and login keeps redirecting', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const res = await request(app).get('/api/auth/hosted-access/login?pi_flow=1');
    expect(res.status).toBe(302);
    await request(app).post('/api/auth/hosted-access/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(404);
  });

  test('identifier-policy tells the SPA whether the front-door modal can run', async () => {
    expect((await request(app).get('/api/auth/hosted-access/identifier-policy')).body.frontDoorPiFlow).toBe(true);
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    expect((await request(app).get('/api/auth/hosted-access/identifier-policy')).body.frontDoorPiFlow).toBe(false);
  });
});
