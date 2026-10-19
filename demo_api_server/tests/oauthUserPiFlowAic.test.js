// AIC sign-in without a redirect: the flow opens at EXTERNAL_AUTHENTICATION_REQUIRED, the browser opens PingOne's
// link in a popup, and the modal polls GET /pi-flow/external until the flow can finish.
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
    aic_login_enabled: 'true',
  })[key]),
  isUserOAuthConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => 'pingone'),
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
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null, error: 'not_found' }) }));
jest.mock('../services/pingOneUserService', () => ({ initialize: jest.fn(), makeRequest: jest.fn() }));

const app = express();
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use('/api/auth/oauth/user', router);

const json = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (h) => ({ 'content-type': 'application/json', ...headers })[h.toLowerCase()] ?? null, getSetCookie: () => [] },
  json: async () => body,
});

const FLOW = 'flow-aic-1';
const authenticateHref = `https://auth.pingone.com/test-env-id/rp/authenticate?isDryRun=false&providerId=p1&flowId=${FLOW}&transactionId=t1`;
const externalFlow = (href = authenticateHref) => ({
  id: FLOW, status: 'EXTERNAL_AUTHENTICATION_REQUIRED',
  _embedded: { identityProvider: { _links: { authenticate: { href } } } },
});

describe('AIC sign-in through the pi.flow modal', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock; });

  const open = async (agent, href) => {
    fetchMock.mockResolvedValueOnce(json(200, externalFlow(href)));
    return agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
  };

  test('opens a pi.flow (no redirect) asking for the AIC_Login policy, and returns the popup link', async () => {
    const res = await open(request.agent(app));
    expect(res.body).toEqual({ flowId: FLOW, status: 'EXTERNAL_AUTHENTICATION_REQUIRED', externalAuthUrl: authenticateHref });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('acr_values')).toBe('AIC_Login');
  });

  test.each([
    ['another host', `https://evil.example/test-env-id/rp/authenticate?flowId=${FLOW}`],
    ['another path', `https://auth.pingone.com/test-env-id/as/authorize?flowId=${FLOW}`],
    ['another flow', 'https://auth.pingone.com/test-env-id/rp/authenticate?flowId=someone-elses-flow'],
    ['http', `http://auth.pingone.com/test-env-id/rp/authenticate?flowId=${FLOW}`],
  ])('never hands the browser a link on %s', async (_name, href) => {
    const res = await open(request.agent(app), href);
    expect(res.body.externalAuthUrl).toBeUndefined();
  });

  test('polling says waiting while the flow is still at the external IdP', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(200, externalFlow()));
    const res = await agent.get('/api/auth/oauth/user/pi-flow/external').expect(200);
    expect(res.body).toEqual({ step: 'external', waiting: true });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://auth.pingone.com/test-env-id/flows/${FLOW}`);
  });

  test('once the flow completes, polling returns redirectTo the unchanged /callback with code and state', async () => {
    const agent = request.agent(app);
    await open(agent);
    fetchMock
      .mockResolvedValueOnce(json(200, { id: FLOW, status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'the-code' } })); // /as/resume
    const res = await agent.get('/api/auth/oauth/user/pi-flow/external').expect(200);
    const to = new URL(res.body.redirectTo);
    expect(to.pathname).toBe('/api/auth/oauth/user/callback');
    expect(to.searchParams.get('code')).toBe('the-code');
    expect(to.searchParams.get('state')).toBeTruthy();
  });

  test('polling with no flow open is 409; a flow PingOne forgot is 410', async () => {
    await request.agent(app).get('/api/auth/oauth/user/pi-flow/external').expect(409);
    const agent = request.agent(app);
    await open(agent);
    fetchMock.mockResolvedValueOnce(json(404, {}));
    const res = await agent.get('/api/auth/oauth/user/pi-flow/external').expect(410);
    expect(res.body.error).toBe('pi_flow_expired');
  });
});
