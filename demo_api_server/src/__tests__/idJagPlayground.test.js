'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: jest.fn(),
  getMcpGatewayHttpUrl: () => 'https://gw.test',
}));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));

const axios = require('axios');
const configStore = require('../../services/configStore');
const oauthService = require('../../services/oauthService');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');
const router = require('../../routes/idJagPlayground');

const PF = 'https://pf.test';
const AS = 'https://mcp-as.test';
const CONFIG = {
  pf_issuer: PF, pf_jwks_uri: `${PF}/pf/JWKS`, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_user_client_id: 'ai-demo-pf-user',
  pf_id_jag_enabled: 'true', pf_id_jag_audience: AS, pf_id_jag_resource: `${AS}/mcp`, pf_id_jag_scope: 'mcp:invoke',
  pf_id_jag_redemption_token_endpoint: `${AS}/token`, pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
  pf_id_jag_redemption_client_secret: 'redeem-secret',
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (header, claims) => `${b64(header)}.${b64(claims)}.c2lnbmF0dXJl`;
const now = () => Math.floor(Date.now() / 1000);
const goodIdJag = (over = {}, hdr = {}) => jwt({ alg: 'RS256', typ: 'oauth-id-jag+jwt', ...hdr }, {
  iss: PF, sub: 'demouser', aud: AS, client_id: 'demo-bff-mcp-client', jti: 'j1', iat: now(), exp: now() + 300,
  resource: `${AS}/mcp`, scope: 'mcp:invoke accounts:read', ...over,
});
const accessToken = jwt({ alg: 'RS256' }, { iss: AS, sub: 'demouser', aud: 'mcpserver.ping.demo', scope: 'accounts:read' });

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const pfSession = () => ({ oauthProvider: 'pingfederate', oauthTokens: { refreshToken: 'rt-secret', idToken: 'idt' } });
const post = (app, path, body) => request(app).post(path).set('Origin', 'https://app.test').send(body || {});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
});
afterEach(() => jest.restoreAllMocks());

describe('ID-JAG playground — spec inspector', () => {
  const okSig = async () => ({ ok: true, note: 'valid' });
  const s = () => router._settings();

  it('passes a spec-conformant ID-JAG', async () => {
    const { checks } = await router._inspect(goodIdJag(), s(), okSig);
    const failed = checks.filter((c) => c.status === 'fail');
    expect(failed).toEqual([]);
  });

  it.each([
    ['typ', goodIdJag({}, { typ: 'JWT' })],
    ['aud', goodIdJag({ aud: [AS, 'https://other.test'] })],
    ['client_id', goodIdJag({ client_id: 'ai-demo-pf-user' })],
    ['iss', goodIdJag({ iss: 'https://evil.test' })],
    ['claim-iat', goodIdJag({ iat: undefined })],
    ['exp', goodIdJag({ exp: now() - 10 })],
    ['scope', goodIdJag({ scope: 'openid profile email offline_access' })],
  ])('fails the %s check when it is wrong', async (id, token) => {
    const { checks } = await router._inspect(token, s(), okSig);
    expect(checks.find((c) => c.id === id).status).toBe('fail');
  });

  it('reports a bad signature', async () => {
    const { checks } = await router._inspect(goodIdJag(), s(), async () => ({ ok: false, note: 'signature verification failed' }));
    expect(checks.find((c) => c.id === 'signature')).toEqual(expect.objectContaining({ status: 'fail', actual: 'signature verification failed' }));
  });

  it('warns (not fails) on a long-lived ID-JAG', async () => {
    const { checks } = await router._inspect(goodIdJag({ exp: now() + 3600 }), s(), okSig);
    expect(checks.find((c) => c.id === 'lifetime').status).toBe('warn');
  });
});

describe('ID-JAG playground — gating', () => {
  it('refuses when the login provider is not PingFederate (there is no PingOne ID-JAG)', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    const res = await post(appWith(pfSession()), '/pg/issue');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('id_jag_provider_required');
  });

  it('requires a PingFederate sign-in', async () => {
    const res = await post(appWith({ oauthProvider: 'pingone', oauthTokens: { refreshToken: 'rt' } }), '/pg/issue');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('pf_sign_in_required');
  });

  it('rejects a cross-origin POST', async () => {
    const res = await request(appWith(pfSession())).post('/pg/issue').set('Origin', 'https://evil.test').send({});
    expect(res.status).toBe(403);
  });
});

describe('ID-JAG playground — flow keeps every raw token server-side', () => {
  it('issue -> redeem -> tools/list, returning decoded claims only', async () => {
    const session = pfSession();
    const app = appWith(session);
    const idJag = goodIdJag();
    oauthService.performIdJagExchange.mockResolvedValue(idJag);
    axios.post.mockResolvedValue({ status: 200, data: { access_token: accessToken, token_type: 'Bearer', scope: 'accounts:read' } });
    callToolViaGateway.mockResolvedValue({ tools: [{ name: 'get_my_accounts', description: 'Accounts' }] });

    const issued = await post(app, '/pg/issue');
    expect(issued.status).toBe(200);
    expect(issued.body.token.claims.client_id).toBe('demo-bff-mcp-client');
    expect(JSON.stringify(issued.body)).not.toContain(idJag);
    expect(JSON.stringify(issued.body)).not.toContain('rt-secret');
    expect(oauthService.performIdJagExchange).toHaveBeenCalledWith('rt-secret', 'urn:ietf:params:oauth:token-type:refresh_token', AS, `${AS}/mcp`, ['mcp:invoke']);

    const redeemed = await post(app, '/pg/redeem', { scope: 'accounts:read' });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.token.claims.scope).toBe('accounts:read');
    expect(JSON.stringify(redeemed.body)).not.toContain(accessToken);
    const [, form, opts] = axios.post.mock.calls[0];
    expect(form).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(form).toContain('scope=accounts%3Aread');
    expect(opts.headers.Authorization).toMatch(/^Basic /);

    const listed = await post(app, '/pg/call');
    expect(listed.body.tools).toEqual([{ name: 'get_my_accounts', description: 'Accounts' }]);
    expect(callToolViaGateway).toHaveBeenCalledWith('https://gw.test', accessToken, null, {}, { rpcMethod: 'tools/list' });
  });

  it('reports a refused redemption with its OAuth error and keeps no token', async () => {
    const session = pfSession();
    const app = appWith(session);
    oauthService.performIdJagExchange.mockResolvedValue(goodIdJag());
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_scope', error_description: 'no scope' } });
    await post(app, '/pg/issue');
    const res = await post(app, '/pg/redeem');
    expect(res.status).toBe(422);
    expect(res.body.response.error).toBe('invalid_scope');
    expect(session.idJagPlayground.accessToken).toBeUndefined();
  });
});

describe('ID-JAG playground — live negative tests', () => {
  beforeEach(() => oauthService.performIdJagExchange.mockResolvedValue(goodIdJag()));

  it('replay: passes when the second redemption is refused', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: accessToken } })
      .mockResolvedValueOnce({ status: 400, data: { error: 'invalid_grant', error_description: 'ID-JAG already redeemed' } });
    const res = await post(appWith(pfSession()), '/pg/negative/replay');
    expect(res.body).toEqual(expect.objectContaining({ pass: true, error: 'invalid_grant' }));
  });

  it('fails a test when the resource AS wrongly issues a token', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { access_token: accessToken } });
    const res = await post(appWith(pfSession()), '/pg/negative/scope-not-granted');
    expect(res.body.pass).toBe(false);
    expect(axios.post.mock.calls[0][1]).toContain('scope=admin%3Adelete');
  });

  it('bad-signature sends a tampered signature', async () => {
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_grant' } });
    const res = await post(appWith(pfSession()), '/pg/negative/bad-signature');
    expect(res.body.pass).toBe(true);
    const sent = decodeURIComponent(new URLSearchParams(axios.post.mock.calls[0][1]).get('assertion'));
    expect(sent.split('.')[2]).not.toBe(goodIdJag().split('.')[2]);
  });

  it('client-mismatch redeems as a different client', async () => {
    axios.post.mockResolvedValue({ status: 401, data: { error: 'invalid_client' } });
    const res = await post(appWith(pfSession()), '/pg/negative/client-mismatch');
    expect(res.body.pass).toBe(true);
    expect(new URLSearchParams(axios.post.mock.calls[0][1]).get('client_id')).toBe('mcp-inspector');
  });
});
