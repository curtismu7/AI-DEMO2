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
    callToolViaGateway.mockResolvedValue({ jsonrpc: '2.0', result: { tools: [{ name: 'get_my_accounts', description: 'Accounts', inputSchema: { type: 'object' } }], _meta: { deniedTools: ['transfer_funds'] } } });

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
    expect(listed.body.tools).toEqual([{ name: 'get_my_accounts', description: 'Accounts', inputSchema: { type: 'object' } }]);
    expect(listed.body.deniedTools).toEqual(['transfer_funds']);
    expect(callToolViaGateway).toHaveBeenCalledWith(null, accessToken, null, {}, { rpcMethod: 'tools/list', pinNodeGateway: true });
  });

  it('always calls the Node demo gateway, even with ff_mcp_gateway_pinggateway on (PingGateway 401s these tokens)', async () => {
    Object.assign(CONFIG, { ff_mcp_gateway_pinggateway: 'true', mcp_demo_gateway_url: 'https://node-gw.test/' });
    try {
      const session = pfSession();
      session.idJagPlayground = { idJag: goodIdJag(), redeemed: true, accessToken };
      callToolViaGateway.mockResolvedValue({ jsonrpc: '2.0', result: { content: [] } });
      const res = await post(appWith(session), '/pg/call', { tool: 'get_my_accounts', arguments: {} });
      expect(callToolViaGateway).toHaveBeenCalledWith(null, accessToken, 'get_my_accounts', {}, { pinNodeGateway: true });
      expect(res.body.request.endpoint).toBe('POST https://node-gw.test/mcp');
    } finally {
      delete CONFIG.ff_mcp_gateway_pinggateway; delete CONFIG.mcp_demo_gateway_url;
    }
  });

  it('refuses a redeem scope that is not in the ID-JAG, before calling the resource AS', async () => {
    const session = pfSession();
    const app = appWith(session);
    oauthService.performIdJagExchange.mockResolvedValue(goodIdJag());
    await post(app, '/pg/issue');
    const res = await post(app, '/pg/redeem', { scope: 'accounts:read admin:delete' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ error: 'scope_not_in_id_jag', message: expect.stringContaining('admin:delete') }));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('tools/list also reads a bare { tools } result, not only the JSON-RPC envelope', async () => {
    const session = pfSession({});
    session.idJagPlayground = { idJag: goodIdJag(), redeemed: true, accessToken };
    callToolViaGateway.mockResolvedValue({ tools: [{ name: 'get_my_accounts' }] });
    const res = await post(appWith(session), '/pg/call');
    expect(res.body.tools.map((t) => t.name)).toEqual(['get_my_accounts']);
  });

  it('a denied tools/call returns the gateway reason (e.g. intent_mismatch)', async () => {
    const session = pfSession();
    session.idJagPlayground = { idJag: goodIdJag(), redeemed: true, accessToken };
    callToolViaGateway.mockRejectedValue(Object.assign(new Error('Tool transfer_funds does not match intent read_accounts'), {
      code: 'gateway_policy_denied', httpStatus: 403, gatewayStatus: 403, gatewayErrorCode: 'intent_mismatch', gatewayMessage: 'Tool transfer_funds does not match intent read_accounts',
    }));
    const res = await post(appWith(session), '/pg/call', { tool: 'transfer_funds', arguments: {} });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'gateway_policy_denied', gatewayStatus: 403, gatewayErrorCode: 'intent_mismatch', gatewayMessage: expect.stringContaining('read_accounts') }));
    expect(res.body.request.body.params.name).toBe('transfer_funds');
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

describe('ID-JAG playground — protected resource (oauth-mcp /protected/profile)', () => {
  const withTokens = () => ({ ...pfSession(), idJagPlayground: { idJag: goodIdJag(), redeemed: true, accessToken } });
  const profile = { status: 200, headers: {}, data: { resource: `${AS}/protected/profile`, verified: [{ check: 'bearer', ok: true }], principal: { sub: 'demouser' } } };

  it('calls the resource server with the access token, and returns its answer without the token', async () => {
    axios.get.mockResolvedValue(profile);
    const res = await post(appWith(withTokens()), '/pg/resource', { variant: 'token' });
    expect(res.status).toBe(200);
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe(`${AS}/protected/profile`);
    expect(opts.headers.Authorization).toBe(`Bearer ${accessToken}`);
    expect(res.body).toEqual(expect.objectContaining({ status: 200, body: profile.data,
      request: { method: 'GET', url: `${AS}/protected/profile`, authorization: 'Bearer [access token]' } }));
    expect(JSON.stringify(res.body)).not.toContain(accessToken);
  });

  it('no-token sends no Authorization; id-jag sends the raw ID-JAG (server-side only) and passes the refusal through', async () => {
    const session = withTokens();
    axios.get.mockResolvedValue({ status: 401, headers: { 'www-authenticate': 'Bearer realm="Protected profile"' }, data: { error: 'unauthorized', verified: [{ check: 'bearer', ok: false }] } });
    const none = await post(appWith(session), '/pg/resource', { variant: 'no-token' });
    expect(axios.get.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(none.body).toEqual(expect.objectContaining({ status: 401, wwwAuthenticate: 'Bearer realm="Protected profile"' }));
    expect(none.body.request.authorization).toBe('none');
    const jag = await post(appWith(session), '/pg/resource', { variant: 'id-jag' });
    expect(axios.get.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${session.idJagPlayground.idJag}`);
    expect(jag.body.request.authorization).toBe('Bearer [the ID-JAG]');
    expect(JSON.stringify(jag.body)).not.toContain(session.idJagPlayground.idJag);
  });

  it('refuses an unknown variant, and the token variant before step 3', async () => {
    expect((await post(appWith(withTokens()), '/pg/resource', { variant: 'other' })).status).toBe(400);
    const res = await post(appWith(pfSession()), '/pg/resource', { variant: 'token' });
    expect(res.status).toBe(409);
    expect(axios.get).not.toHaveBeenCalled();
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

describe('ID-JAG playground — PingFederate on both ends (pf-pf)', () => {
  const SE = 'https://se-pf.test';
  beforeEach(() => {
    process.env.PF_IDJAG_ISSUER_PF_URL = SE;
    process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'redeemer-secret';
    Object.assign(CONFIG, { pf_token_endpoint: `${PF}/as/token.oauth2`, pf_user_client_secret: 'user-secret' });
  });
  afterEach(() => { delete process.env.PF_IDJAG_ISSUER_PF_URL; delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET; });

  it('switches mode, describes the pairing, and clears tokens from the other pairing', async () => {
    const session = { idJagPlayground: { idJag: 'x' }, save: (cb) => cb() };
    const res = await post(appWith(session), '/pg/mode', { mode: 'pf-pf' });
    expect(res.body.mode).toBe('pf-pf');
    expect(res.body.idp.issuer).toBe(SE);
    expect(res.body.resourceAs).toEqual(expect.objectContaining({ issuer: PF, clientId: 'ai-demo-pf-idjag-redeemer' }));
    expect(res.body.request.audience).toBe(PF);
    expect(res.body.modes.find((m) => m.id === 'pf-pf').available).toBe(true);
    expect(session.idJagPlayground).toBeUndefined();
    expect((await post(appWith(session), '/pg/mode', { mode: 'nope' })).status).toBe(400);
  });

  it('marks pf-pf unavailable without the redeemer secret', async () => {
    delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET;
    const res = await request(appWith({})).get('/pg/config');
    expect(res.body.modes.find((m) => m.id === 'pf-pf')).toEqual(expect.objectContaining({ available: false }));
  });

  it('needs the SE PingFederate sign-in, not the app provider', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    const res = await post(appWith({ idJagPlaygroundMode: 'pf-pf' }), '/pg/issue');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('pf_sign_in_required');
  });

  it('issuer login redirects to the SE PingFederate with PKCE, and the callback keeps the refresh token server-side', async () => {
    const session = { idJagPlaygroundMode: 'pf-pf', save: (cb) => cb() };
    const app = appWith(session);
    const login = await request(app).get('/pg/issuer/login?return_to=/pingfederate-id-jag/playground');
    const to = new URL(login.headers.location);
    expect(to.origin + to.pathname).toBe(`${SE}/as/authorization.oauth2`);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('redirect_uri')).toBe('https://app.test/api/id-jag-playground/issuer/callback');
    axios.post.mockResolvedValue({ status: 200, data: { refresh_token: 'se-rt', id_token: jwt({ alg: 'RS256' }, { sub: 'demouser' }) } });
    const cb = await request(app).get(`/pg/issuer/callback?code=c1&state=${to.searchParams.get('state')}`);
    expect(cb.headers.location).toBe('/pingfederate-id-jag/playground');
    expect(session.idJagIssuer).toEqual({ refreshToken: 'se-rt', sub: 'demouser' });
    expect(axios.post.mock.calls[0][0]).toBe(`${SE}/as/token.oauth2`);
  });

  it('rejects a callback with the wrong state', async () => {
    const session = { idJagIssuerLogin: { state: 's1', verifier: 'v', returnTo: '/pingfederate-id-jag/playground', at: Date.now() }, save: (cb) => cb() };
    const cb = await request(appWith(session)).get('/pg/issuer/callback?code=c1&state=evil');
    expect(cb.headers.location).toContain('issuer_error=invalid_state');
    expect(session.idJagIssuer).toBeUndefined();
  });

  it('issues at the SE PingFederate and redeems at the local PingFederate as the redeemer client', async () => {
    const session = { idJagPlaygroundMode: 'pf-pf', idJagIssuer: { refreshToken: 'se-rt' } };
    const app = appWith(session);
    const idJag = goodIdJag({ iss: SE, aud: PF, client_id: 'ai-demo-pf-idjag-redeemer' });
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: idJag, issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' } })
      .mockResolvedValueOnce({ status: 200, data: { access_token: accessToken } });
    const issued = await post(app, '/pg/issue');
    expect(issued.status).toBe(200);
    const [url, form] = axios.post.mock.calls[0];
    expect(url).toBe(`${SE}/as/token.oauth2`);
    expect(new URLSearchParams(form).get('audience')).toBe(PF);
    expect(JSON.stringify(issued.body)).not.toContain('se-rt');
    expect(oauthService.performIdJagExchange).not.toHaveBeenCalled();
    const redeemed = await post(app, '/pg/redeem');
    expect(redeemed.status).toBe(200);
    const [rUrl, rForm, rOpts] = axios.post.mock.calls[1];
    expect(rUrl).toBe(`${PF}/as/token.oauth2`);
    expect(new URLSearchParams(rForm).get('client_id')).toBe('ai-demo-pf-idjag-redeemer');
    expect(rOpts.headers.Authorization).toBe(`Basic ${Buffer.from('ai-demo-pf-idjag-redeemer:redeemer-secret').toString('base64')}`);
  });
});
