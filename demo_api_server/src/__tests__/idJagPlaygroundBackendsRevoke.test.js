'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));

const axios = require('axios');
const configStore = require('../../services/configStore');
const oauthService = require('../../services/oauthService');
const router = require('../../routes/idJagPlayground');

const PF = 'https://pf.test';
const AS = 'https://mcp-as.test';
const CONFIG = {
  pf_issuer: PF, pf_jwks_uri: `${PF}/pf/JWKS`, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_user_client_id: 'ai-demo-pf-user',
  pf_user_client_secret: 'pf-user-secret', pf_id_jag_enabled: 'true', pf_id_jag_audience: AS, pf_id_jag_resource: `${AS}/mcp`,
  pf_id_jag_scope: 'mcp:invoke', pf_id_jag_redemption_token_endpoint: `${AS}/token`, pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
  pf_id_jag_redemption_client_secret: 'redeem-secret',
};

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const signedIn = () => ({ oauthProvider: 'pingfederate', oauthTokens: { refreshToken: 'rt-secret' }, idJagPlayground: { idJag: 'x.y.z' } });
const refusal = (error) => Object.assign(new Error(`PingFederate ID-JAG exchange failed: ${error}`), { httpStatus: 400, pfError: error, pfErrorDescription: 'refused' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
});
afterEach(() => jest.restoreAllMocks());

describe('ID-JAG playground — backends strip', () => {
  const s = () => router._settings('oauth-mcp');
  const answer = (status) => jest.fn().mockResolvedValue({ status });

  it('marks each backend up, slow or down from its discovery answer', async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ status: 200 }) // idp
      .mockResolvedValueOnce({ status: 200 }); // resource AS
    const backends = await router._probeBackends(s(), get);
    expect(backends.map((b) => [b.id, b.state])).toEqual([['idp', 'up'], ['resource-as', 'up']]);
    expect(get.mock.calls[0][0]).toBe(`${PF}/.well-known/openid-configuration`);
    expect(get.mock.calls[0][1]).toEqual(expect.objectContaining({ timeout: 4000 }));
  });

  it('reports a timeout as down with the reason', async () => {
    const get = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    const backends = await router._probeBackends(s(), get);
    expect(backends.find((b) => b.id === 'idp')).toEqual(expect.objectContaining({ state: 'down', detail: 'no answer in 4 s' }));
  });

  it('falls back to OpenID configuration when the resource AS has no RFC 8414 metadata', async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 200 });
    const resourceAs = (await router._probeBackends({ ...s(), idp: { name: 'PF', issuer: '' } }, get))[0];
    expect(resourceAs).toEqual(expect.objectContaining({ id: 'resource-as', state: 'up', url: `${AS}/.well-known/openid-configuration` }));
  });

  it('adds the MCP gateway chip (its /health) when a gateway URL is configured', async () => {
    const get = answer(200);
    const backends = await router._probeBackends(s(), get, 'http://gw.test:3005/');
    expect(backends.map((b) => [b.id, b.state])).toEqual([['idp', 'up'], ['resource-as', 'up'], ['mcp', 'up']]);
    expect(get.mock.calls.map((c) => c[0])).toContain('http://gw.test:3005/health');
  });

  it('leaves out a backend with no address in this mode', async () => {
    const backends = await router._probeBackends({ ...s(), idp: { name: 'Your IdP', issuer: '' } }, answer(200));
    expect(backends.map((b) => b.id)).toEqual(['resource-as']);
  });
});

describe('ID-JAG playground — revoke and prove it', () => {
  const app = (session = signedIn()) => appWith(session);
  const post = (a) => request(a).post('/pg/revoke').set('Origin', 'https://app.test').send({});

  it('does not revoke when the exchange already fails (control)', async () => {
    oauthService.performIdJagExchange.mockRejectedValue(refusal('invalid_client'));
    const res = await post(app());
    expect(res.body.proved).toBe(false);
    expect(res.body.control).toEqual(expect.objectContaining({ ok: false, status: 400, error: 'invalid_client' }));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('proves revocation when the retry is refused with invalid_request', async () => {
    oauthService.performIdJagExchange
      .mockResolvedValueOnce('control.id.jag')
      .mockRejectedValueOnce(refusal('invalid_request'));
    axios.post.mockResolvedValue({ status: 200, data: {} });
    const session = signedIn();
    const res = await post(app(session));
    expect(axios.post).toHaveBeenCalledWith(`${PF}/as/revoke_token.oauth2`, expect.stringContaining('token=rt-secret'), expect.anything());
    expect(res.body).toEqual(expect.objectContaining({ proved: true, revoke: expect.objectContaining({ status: 200 }) }));
    expect(res.body.revoke.request.body.token).toBe('[your refresh token, never sent to the browser]');
    expect(res.body.control.request.body.subject_token).toBe('[your session token, never sent to the browser]');
    expect(session.idJagPlayground).toBeUndefined();
  });

  it('does not prove when the issuer refuses the revocation', async () => {
    oauthService.performIdJagExchange.mockResolvedValueOnce('control.id.jag').mockRejectedValueOnce(refusal('invalid_request'));
    axios.post.mockResolvedValue({ status: 500, data: { error: 'server_error' } });
    const res = await post(app());
    expect(res.body.proved).toBe(false);
    expect(res.body.revoke).toEqual(expect.objectContaining({ status: 500, error: 'server_error' }));
  });

  it('does not prove when the retry still succeeds', async () => {
    oauthService.performIdJagExchange.mockResolvedValue('still.valid.jag');
    axios.post.mockResolvedValue({ status: 200, data: {} });
    const res = await post(app());
    expect(res.body.proved).toBe(false);
    expect(res.body.retry.ok).toBe(true);
  });

  it('refuses without a PingFederate sign-in', async () => {
    const res = await post(app({ oauthProvider: 'pingfederate' }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('pf_sign_in_required');
  });
});

describe('ID-JAG playground — start over', () => {
  const restart = (session) => request(appWith(session)).post('/pg/restart').set('Origin', 'https://app.test').send({});

  it('forgets the ID-JAG and access token but keeps the sign-in at the issuer', async () => {
    const session = { idJagPlayground: { idJag: 'x.y.z', redeemed: true, accessToken: 'at' }, idJagIssuer: { refreshToken: 'rt-secret' }, oauthTokens: { refreshToken: 'rt' } };
    const res = await restart(session);
    expect(res.body).toEqual({ ok: true });
    expect(session.idJagPlayground).toBeUndefined();
    expect(session.idJagIssuer).toEqual({ refreshToken: 'rt-secret' });
    expect(session.oauthTokens).toEqual({ refreshToken: 'rt' });
  });

  it('is refused from another origin (CSRF), like every write', async () => {
    const res = await request(appWith(signedIn())).post('/pg/restart').set('Origin', 'https://evil.test').send({});
    expect(res.status).toBe(403);
  });
});

describe('ID-JAG playground — config names who is signed in', () => {
  it('in oauth-mcp it is the app user, only while signed in', async () => {
    const asUser = await request(appWith({ ...signedIn(), user: { email: 'cmuir@pingone.com' } })).get('/pg/config');
    expect(asUser.body.signedIn).toBe(true);
    expect(asUser.body.signedInAs).toBe('cmuir@pingone.com');
    const out = await request(appWith({ oauthProvider: 'pingfederate' })).get('/pg/config');
    expect(out.body.signedInAs).toBeNull();
  });
});
