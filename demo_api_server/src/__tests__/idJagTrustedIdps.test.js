'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    req.user = JSON.parse(h);
    return next();
  },
  requireAdmin: (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'admin_required' })),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const trustedIdps = require('../../services/idJagTrustedIdps');
const router = require('../../routes/idJagPlayground');
const { isHostedAccessBypassPath } = require('../../middleware/hostedAccessGate');

const PF = 'https://pf.test';
const AS = 'https://mcp-as.test';
const OUT = 'https://idp.partner.test';
let store;
const CONFIG = {
  pf_issuer: PF, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_id_jag_enabled: 'true', pf_id_jag_audience: AS,
  pf_id_jag_resource: `${AS}/mcp`, pf_id_jag_redemption_token_endpoint: `${AS}/token`,
  pf_id_jag_redemption_client_id: 'demo-bff-mcp-client', pf_id_jag_redemption_client_secret: 'redeem-secret',
};

const ENTRY = {
  id: 'partner', name: 'Partner IdP', issuer: OUT, jwksUrl: `${OUT}/jwks`, idJagClientId: 'partner-knows-us-as',
  scopes: 'mcp:read', targets: ['oauth-mcp', 'pingfederate'],
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const theirIdJag = (over = {}) => `${b64({ alg: 'RS256', typ: 'oauth-id-jag+jwt', x5t: 'k1' })}.${b64({
  iss: OUT, sub: 'alice', aud: AS, client_id: 'partner-knows-us-as', jti: 'j9', iat: now(), exp: now() + 300, scope: 'mcp:read', ...over,
})}.c2lnbmF0dXJl`;
const accessToken = `${b64({ alg: 'RS256' })}.${b64({ iss: AS, sub: 'alice', scope: 'mcp:read' })}.c2ln`;

function appWith(session = {}) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const ADMIN = JSON.stringify({ id: 'a', role: 'admin' });
const USER = JSON.stringify({ id: 'u', role: 'customer' });
const send = (app, method, path, body, user = ADMIN) => request(app)[method](path).set('Origin', 'https://app.test').set('x-test-user', user).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => store[k] ?? CONFIG[k]);
  jest.spyOn(configStore, 'setRaw').mockImplementation(async (d) => { Object.assign(store, d); });
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
});
afterEach(() => jest.restoreAllMocks());

describe('trusted-IdP registry module', () => {
  it('creates with defaults and persists as JSON under one key', async () => {
    const e = await trustedIdps.create({ ...ENTRY, scopes: '  mcp:read   mcp:write ' });
    expect(e).toEqual(expect.objectContaining({ clientId: 'demo-bff-mcp-client', pfClientId: 'ai-demo-pf-idjag-redeemer', scopes: 'mcp:read mcp:write', enabled: true }));
    expect(JSON.parse(store.id_jag_trusted_idps)).toHaveLength(1);
  });

  it.each([
    ['http issuer', { issuer: 'http://idp.test' }, /issuer must be an https URL/],
    ['bad jwks', { jwksUrl: 'not a url' }, /jwksUrl must be an https URL/],
    ['bad slug', { id: 'Has Spaces' }, /slug/],
    ['bad target', { targets: ['okta'] }, /targets/],
    ['no targets', { targets: [] }, /targets/],
    ['no idJagClientId', { idJagClientId: '' }, /idJagClientId/],
  ])('rejects %s', async (_n, over, msg) => {
    await expect(trustedIdps.create({ ...ENTRY, ...over })).rejects.toThrow(msg);
  });

  it('keeps id and issuer unique, but lets an entry update itself', async () => {
    await trustedIdps.create(ENTRY);
    await expect(trustedIdps.create({ ...ENTRY, issuer: 'https://other.test' })).rejects.toThrow(/already used/);
    await expect(trustedIdps.create({ ...ENTRY, id: 'two' })).rejects.toThrow(/already registered/);
    expect((await trustedIdps.update('partner', { ...ENTRY, name: 'Renamed' })).name).toBe('Renamed');
    await expect(trustedIdps.update('nope', ENTRY)).rejects.toThrow(/no trusted IdP/);
  });
});

describe('trusted-IdP endpoints', () => {
  const BEARER = 'Bearer registry-test-token';
  beforeEach(() => { process.env.ID_JAG_REGISTRY_TOKEN = 'registry-test-token'; });
  afterEach(() => { delete process.env.ID_JAG_REGISTRY_TOKEN; });

  it('registry reads list only enabled entries for their target, with client aliases', async () => {
    await trustedIdps.create(ENTRY);
    await trustedIdps.create({ ...ENTRY, id: 'pf-only', issuer: 'https://pf-only.test', targets: ['pingfederate'] });
    await trustedIdps.create({ ...ENTRY, id: 'off', issuer: 'https://off.test', enabled: false });
    const res = await request(appWith()).get('/pg/trusted-idps/registry').set('Authorization', BEARER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ idps: [{ id: 'partner', issuer: OUT, jwksUrl: `${OUT}/jwks`, clientAliases: { 'partner-knows-us-as': 'demo-bff-mcp-client' }, scopes: 'mcp:read' }] });
    const pf = await request(appWith()).get('/pg/trusted-idps/pingfederate').set('Authorization', BEARER);
    expect(pf.body.idps.map((e) => e.id)).toEqual(['partner', 'pf-only']);
    expect(pf.body.idps[0]).toEqual({ id: 'partner', name: 'Partner IdP', issuer: OUT, jwksUrl: `${OUT}/jwks`, pfClientId: 'ai-demo-pf-idjag-redeemer', scopes: 'mcp:read' });
  });

  it.each(['registry', 'pingfederate'])('/trusted-idps/%s needs the shared registry token', async (path) => {
    const get = () => request(appWith()).get(`/pg/trusted-idps/${path}`);
    expect((await get()).status).toBe(401);
    expect((await get().set('Authorization', 'Bearer wrong-token')).status).toBe(401);
    expect((await get().set('Authorization', 'Bearer registry-test-token-and-more')).status).toBe(401);
    expect((await get().set('Authorization', BEARER)).status).toBe(200);
  });

  it('refuses registry reads with 503 when no registry token is configured', async () => {
    delete process.env.ID_JAG_REGISTRY_TOKEN;
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(appWith()).get('/pg/trusted-idps/registry').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('registry_auth_unconfigured');
    expect(err.mock.calls[0][0]).toMatch(/ID_JAG_REGISTRY_TOKEN is not set/);
  });

  it('the hosted-access wall lets the two server-to-server reads through', () => {
    expect(isHostedAccessBypassPath('/api/id-jag-playground/trusted-idps/registry', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/id-jag-playground/trusted-idps/pingfederate', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/id-jag-playground/trusted-idps', 'GET')).toBe(false);
  });

  it('admin CRUD; non-admins read only; signed-out gets 401', async () => {
    const app = appWith();
    expect((await send(app, 'post', '/pg/trusted-idps', ENTRY)).status).toBe(201);
    expect((await send(app, 'post', '/pg/trusted-idps', ENTRY)).status).toBe(400);
    expect((await send(app, 'put', '/pg/trusted-idps/partner', { ...ENTRY, enabled: false })).body.enabled).toBe(false);
    expect((await send(app, 'post', '/pg/trusted-idps', { ...ENTRY, id: 'x', issuer: 'https://x.test' }, USER)).status).toBe(403);
    expect((await send(app, 'delete', '/pg/trusted-idps/partner', undefined, USER)).status).toBe(403);
    const read = await send(app, 'get', '/pg/trusted-idps', undefined, USER);
    expect(read.body).toEqual(expect.objectContaining({ canManage: false, idps: [expect.objectContaining({ id: 'partner' })] }));
    expect((await request(app).get('/pg/trusted-idps')).status).toBe(401);
    expect((await send(app, 'delete', '/pg/trusted-idps/partner')).status).toBe(204);
    expect((await send(app, 'delete', '/pg/trusted-idps/partner')).status).toBe(404);
  });

  it('rejects a cross-origin registry write', async () => {
    const res = await request(appWith()).delete('/pg/trusted-idps/partner').set('Origin', 'https://evil.test').set('x-test-user', ADMIN);
    expect(res.status).toBe(403);
  });
});

describe('byo mode: your IdP -> our resource AS', () => {
  const byoSession = () => ({ idJagPlaygroundMode: 'byo', save: (cb) => cb() });
  beforeEach(() => {
    process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'redeemer-secret';
    axios.get.mockResolvedValue({ data: { keys: [] } }); // JWKS lookup: no key, signature check fails, no network
  });
  afterEach(() => { delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET; });

  it('is always offered and selectable', async () => {
    const res = await send(appWith({ save: (cb) => cb() }), 'post', '/pg/mode', { mode: 'byo' });
    expect(res.body.mode).toBe('byo');
    expect(res.body.modes.find((m) => m.id === 'byo')).toEqual(expect.objectContaining({ available: true, label: 'Your IdP → our resource AS' }));
    expect(res.body.publicEndpoints['oauth-mcp']).toEqual({ issuer: AS, tokenEndpoint: `${AS}/token` });
    expect(res.body.publicEndpoints.pingfederate).toEqual({ issuer: PF, tokenEndpoint: `${PF}/as/token.oauth2` });
  });

  it('unknown issuer fails "Issuer is a trusted IdP" with a hint and stores nothing', async () => {
    const session = byoSession();
    const res = await send(appWith(session), 'post', '/pg/byo/inspect', { idJag: theirIdJag({ iss: 'https://stranger.test' }) });
    expect(res.body.trusted).toBe(false);
    expect(res.body.checks).toEqual([expect.objectContaining({ id: 'trusted-idp', label: 'Issuer is a trusted IdP', status: 'fail', actual: 'https://stranger.test' })]);
    expect(res.body.hint).toMatch(/Trusted IdPs panel/);
    expect(session.idJagPlayground).toBeUndefined();
  });

  it('rejects something that is not a JWT', async () => {
    expect((await send(appWith(byoSession()), 'post', '/pg/byo/inspect', { idJag: 'hello' })).status).toBe(400);
  });

  it('inspects against the IdP entry, never echoes the raw token, and redeems at oauth-mcp as entry.clientId', async () => {
    await trustedIdps.create(ENTRY);
    const session = byoSession();
    const app = appWith(session);
    const idJag = theirIdJag();
    const res = await send(app, 'post', '/pg/byo/inspect', { idJag, target: 'oauth-mcp' });
    expect(res.body.trusted).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(idJag);
    const byId = Object.fromEntries(res.body.checks.map((c) => [c.id, c]));
    expect(byId.iss.status).toBe('pass');
    expect(byId.aud).toEqual(expect.objectContaining({ status: 'pass', expected: AS }));
    expect(byId.client_id).toEqual(expect.objectContaining({ status: 'pass', expected: 'partner-knows-us-as' }));
    expect(byId.signature.status).toBe('fail');
    expect(axios.get).toHaveBeenCalledWith(`${OUT}/jwks`, expect.anything());
    expect(session.idJagPlayground.byo).toEqual({ target: 'oauth-mcp', idpId: 'partner' });

    axios.post.mockResolvedValue({ status: 200, data: { access_token: accessToken, token_type: 'Bearer' } });
    const red = await send(app, 'post', '/pg/redeem', {});
    expect(red.status).toBe(200);
    const [url, form, opts] = axios.post.mock.calls[0];
    expect(url).toBe(`${AS}/token`);
    expect(new URLSearchParams(form).get('client_id')).toBe('demo-bff-mcp-client');
    expect(new URLSearchParams(form).get('assertion')).toBe(idJag);
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('demo-bff-mcp-client:redeem-secret').toString('base64')}`);
    expect(JSON.stringify(red.body)).not.toContain(accessToken);
    expect(session.idJagPlayground.accessToken).toBe(accessToken);
  });

  it('redeems at the local PingFederate as entry.pfClientId with the redeemer secret', async () => {
    await trustedIdps.create({ ...ENTRY, pfClientId: 'partner-redeemer' });
    const app = appWith(byoSession());
    await send(app, 'post', '/pg/byo/inspect', { idJag: theirIdJag({ aud: PF }), target: 'pingfederate' });
    axios.post.mockResolvedValue({ status: 200, data: { access_token: accessToken } });
    const red = await send(app, 'post', '/pg/redeem', {});
    expect(red.status).toBe(200);
    const [url, form, opts] = axios.post.mock.calls[0];
    expect(url).toBe(`${PF}/as/token.oauth2`);
    expect(new URLSearchParams(form).get('client_id')).toBe('partner-redeemer');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('partner-redeemer:redeemer-secret').toString('base64')}`);
  });

  it('an IdP not enabled for the chosen target is refused at inspect', async () => {
    await trustedIdps.create({ ...ENTRY, targets: ['oauth-mcp'] });
    const res = await send(appWith(byoSession()), 'post', '/pg/byo/inspect', { idJag: theirIdJag(), target: 'pingfederate' });
    expect(res.body.trusted).toBe(false);
    expect(res.body.hint).toMatch(/not for pingfederate/);
  });

  it('negative tests reuse the pasted ID-JAG and skip replay', async () => {
    await trustedIdps.create(ENTRY);
    const app = appWith(byoSession());
    const idJag = theirIdJag();
    await send(app, 'post', '/pg/byo/inspect', { idJag });
    const replay = await send(app, 'post', '/pg/negative/replay', {});
    expect(replay.body).toEqual(expect.objectContaining({ skipped: true, pass: null }));
    expect(axios.post).not.toHaveBeenCalled();
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_scope' } });
    const neg = await send(app, 'post', '/pg/negative/scope-not-granted', {});
    expect(neg.body.pass).toBe(true);
    expect(new URLSearchParams(axios.post.mock.calls[0][1]).get('assertion')).toBe(idJag);
  });

  it('issue is not available in byo mode', async () => {
    expect((await send(appWith(byoSession()), 'post', '/pg/issue', {})).status).toBe(409);
  });
});
