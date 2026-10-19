'use strict';

// pf-pf sign-in at the SE PingFederate without leaving the page: the shared pi.flow driver, in a private session bag.

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));

const configStore = require('../../services/configStore');
const router = require('../../routes/idJagPlayground');

const SE = 'https://se-pf.test';
const CONFIG = { pf_issuer: 'https://pf.test', pf_user_client_id: 'ai-demo-pf-user', pf_user_client_secret: 'user-secret', pf_id_jag_enabled: 'true' };

const res = (status, body) => ({ status, ok: status < 400, headers: { get: () => 'application/json', getSetCookie: () => [] }, json: async () => body });
const appWith = (session) => {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
};
const newSession = () => ({ idJagPlaygroundMode: 'pf-pf', save: (cb) => cb() });
const post = (app, path, body) => request(app).post(path).set('Origin', 'https://app.test').send(body || {});

beforeEach(() => {
  process.env.PF_IDJAG_ISSUER_PF_URL = SE;
  process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'redeemer-secret';
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingone');
  global.fetch = jest.fn();
});
afterEach(() => {
  delete process.env.PF_IDJAG_ISSUER_PF_URL;
  delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET;
  jest.restoreAllMocks();
});

describe('pf-pf issuer sign-in through the pi.flow modal', () => {
  it('?pi_flow=1 opens a pi.flow at the SE PingFederate and answers JSON, not a redirect', async () => {
    global.fetch.mockResolvedValueOnce(res(200, { id: 'flow-issuer-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    const session = newSession();
    const r = await request(appWith(session)).get('/pg/issuer/login?pi_flow=1&return_to=/pingfederate-id-jag/playground');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ flowId: 'flow-issuer-1', status: 'USERNAME_PASSWORD_REQUIRED' });
    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.origin).toBe(SE);
    expect(url.pathname).toBe('/as/authorization.oauth2');
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('client_id')).toBe('ai-demo-pf-user');
    // The app's own sign-in state is untouched; the flow's state is in the private bag.
    expect(session.oauthState).toBeUndefined();
    expect(session.idJagIssuerPiFlow.oauthState).toBe(session.idJagIssuerLogin.state);
    expect(session.idJagIssuerPiFlow.oauthRedirectUri).toBe('https://app.test/api/id-jag-playground/issuer/callback');
  });

  it('a password that completes the flow hands the browser to /issuer/callback with the code and state', async () => {
    global.fetch.mockResolvedValueOnce(res(200, { id: 'flow-issuer-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    const session = newSession();
    const app = appWith(session);
    await request(app).get('/pg/issuer/login?pi_flow=1');
    const { state } = session.idJagIssuerLogin;
    global.fetch.mockResolvedValueOnce(res(200, { status: 'COMPLETED', authorizeResponse: { code: 'the-code', state } }));
    const r = await post(app, '/pg/issuer/pi-flow/credentials', { username: 'demo', password: 'pw' });
    expect(r.status).toBe(200);
    const to = new URL(r.body.redirectTo);
    expect(`${to.origin}${to.pathname}`).toBe('https://app.test/api/id-jag-playground/issuer/callback');
    expect(to.searchParams.get('code')).toBe('the-code');
    expect(to.searchParams.get('state')).toBe(state);
    const step = global.fetch.mock.calls[1];
    expect(step[0]).toBe(`${SE}/pf-ws/authn/flows/flow-issuer-1`);
    expect(step[1].headers['Content-Type']).toBe('application/vnd.pingidentity.checkUsernamePassword+json');
  });

  it('a flow state that does not match this login is refused (no code is handed on)', async () => {
    global.fetch.mockResolvedValueOnce(res(200, { id: 'flow-issuer-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    const app = appWith(newSession());
    await request(app).get('/pg/issuer/login?pi_flow=1');
    global.fetch.mockResolvedValueOnce(res(200, { status: 'COMPLETED', authorizeResponse: { code: 'c', state: 'someone-elses' } }));
    const r = await post(app, '/pg/issuer/pi-flow/credentials', { username: 'demo', password: 'pw' });
    expect(r.body.redirectTo).toBeUndefined();
  });

  it('without the redeemer secret pf-pf is unavailable: 409 for pi.flow, and credentials are refused', async () => {
    delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET;
    const app = appWith(newSession());
    expect((await request(app).get('/pg/issuer/login?pi_flow=1')).status).toBe(409);
    expect((await post(app, '/pg/issuer/pi-flow/credentials', { username: 'a', password: 'b' })).status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('without pi_flow the issuer login is still the redirect (the modal\'s fallback)', async () => {
    const r = await request(appWith(newSession())).get('/pg/issuer/login?return_to=/pingfederate-id-jag/playground');
    expect(r.status).toBe(302);
    expect(new URL(r.headers.location).searchParams.get('response_mode')).toBeNull();
    expect(new URL(r.headers.location).origin).toBe(SE);
  });
});
