'use strict';

// GET /api/id-jag-playground/preflight: every check that can block a playground button,
// its fail path, and the concrete fix sentence the page shows.

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://app.test',
  getUserRedirectUri: () => 'https://app.test/api/auth/oauth/user/callback',
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const trustedIdps = require('../../services/idJagTrustedIdps');
const router = require('../../routes/idJagPlayground');

const PF = 'https://pf.test';
const SE = 'https://se-pf.test';
const AS = 'https://mcp-as.test';
const CONFIG = {
  pf_issuer: PF, pf_jwks_uri: `${PF}/pf/JWKS`, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_user_client_id: 'ai-demo-pf-user',
  pf_user_client_secret: 'user-secret-value', pf_id_jag_enabled: 'true', pf_id_jag_audience: AS, pf_id_jag_resource: `${AS}/mcp`,
  pf_id_jag_scope: 'mcp:invoke', pf_id_jag_redemption_token_endpoint: `${AS}/token`, pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
  pf_id_jag_redemption_client_secret: 'redeem-secret-value',
};
let config;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'oauth-id-jag+jwt' })}.${b64(claims)}.c2ln`;
const now = () => Math.floor(Date.now() / 1000);
const idJag = (over = {}) => jwt({ iss: PF, aud: AS, iat: now(), exp: now() + 300, ...over });

const RSA1 = { kty: 'RSA', kid: 'a', n: 'n1', e: 'AQAB', x5t: 't1' };
const RSA2 = { kty: 'RSA', kid: 'b', n: 'n2', e: 'AQAB', x5t: 't2' };
const refused = () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
let net;
const healthy = () => ({
  [`${PF}/.well-known/openid-configuration`]: { status: 200, data: { issuer: PF } },
  [`${PF}/pf/JWKS`]: { status: 200, data: { keys: [RSA1, { ...RSA1, kid: 'a-dup' }] } },
  [`${AS}/token`]: { status: 405, data: {} },
  [`${SE}/.well-known/openid-configuration`]: { status: 200, data: { issuer: SE } },
  [`${SE}/pf/JWKS`]: { status: 200, data: { keys: [RSA1] } },
  [`${PF}/as/token.oauth2`]: { status: 400, data: { error: 'invalid_request' } },
});

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const pfSession = (over = {}) => ({ oauthProvider: 'pingfederate', oauthTokens: { refreshToken: 'rt-secret', accessToken: 'at-secret' }, ...over });
const pre = (session, query) => request(appWith(session)).get('/pg/preflight').query({ origin: 'https://app.test', ...query });
const check = (res, id) => res.body.checks.find((c) => c.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  router._clearProbeCache();
  config = { ...CONFIG };
  net = healthy();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => config[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
  axios.get.mockImplementation((url) => (net[url] ? Promise.resolve(net[url]) : Promise.reject(refused())));
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.PF_IDJAG_ISSUER_PF_URL;
  delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET;
});

describe('preflight — shape', () => {
  it('rejects an unknown step', async () => {
    expect((await pre(pfSession(), { step: 'nope' })).status).toBe(400);
  });

  it('passes a healthy oauth-mcp issue step', async () => {
    const res = await pre(pfSession(), { step: 'issue' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['origin', 'provider', 'enabled', 'config', 'signed-in', 'issuer', 'jwks']));
    expect(res.body.checks.filter((c) => c.status !== 'pass')).toEqual([]);
  });

  it('never returns a token or a secret', async () => {
    const session = pfSession({ idJagPlayground: { idJag: idJag(), accessToken: jwt({ exp: now() + 60 }) } });
    const out = [];
    for (const step of ['signin', 'issue', 'redeem', 'call', 'negative']) out.push(JSON.stringify((await pre(session, { step })).body));
    const all = out.join('\n');
    for (const secret of ['rt-secret', 'at-secret', 'user-secret-value', 'redeem-secret-value', session.idJagPlayground.idJag, session.idJagPlayground.accessToken]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('preflight — host, provider, sign-in, config', () => {
  it('fails on the wrong host and says which page to open', async () => {
    const res = await pre(pfSession(), { step: 'signin', origin: 'https://api.ping.demo:4000' });
    expect(res.body.ok).toBe(false);
    expect(check(res, 'origin')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(check(res, 'origin').fix).toContain('https://app.test/pingfederate-id-jag/playground');
  });

  it('falls back to the Referer when the page sends no origin', async () => {
    const res = await request(appWith(pfSession())).get('/pg/preflight?step=issue').set('Referer', 'https://other.test/pingfederate-id-jag/playground');
    expect(check(res, 'origin').status).toBe('fail');
  });

  it('fails oauth-mcp when the login provider is PingOne', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    const res = await pre(pfSession(), { step: 'issue' });
    expect(check(res, 'provider')).toEqual(expect.objectContaining({ status: 'fail' }));
    expect(check(res, 'provider').fix).toMatch(/PingFederate/);
  });

  it('fails when not signed in, and names the missing refresh token when that is the gap', async () => {
    const out = await pre({}, { step: 'issue' });
    expect(check(out, 'signed-in').status).toBe('fail');
    expect(check(out, 'signed-in').fix).toMatch(/Sign in/);
    const noRt = await pre(pfSession({ oauthTokens: { accessToken: 'at' } }), { step: 'issue' });
    expect(check(noRt, 'signed-in')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringMatching(/refresh token/) }));
  });

  it('lists missing config by name', async () => {
    delete config.pf_id_jag_redemption_token_endpoint;
    const res = await pre(pfSession(), { step: 'redeem' });
    expect(check(res, 'config')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringContaining('pf_id_jag_redemption_token_endpoint') }));
  });

  it('fails when the server session is in another mode than the page', async () => {
    const res = await pre(pfSession(), { step: 'issue', mode: 'pf-pf' });
    expect(check(res, 'mode-sync')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/Reload/) }));
  });
});

describe('preflight — live issuer and resource AS', () => {
  it('fails when the issuer is unreachable', async () => {
    delete net[`${PF}/.well-known/openid-configuration`];
    const res = await pre(pfSession(), { step: 'issue' });
    expect(check(res, 'issuer')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringContaining('pf_issuer') }));
    expect(axios.get).toHaveBeenCalledWith(`${PF}/.well-known/openid-configuration`, expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('fails when discovery reports a different issuer, and gives the exact value', async () => {
    net[`${PF}/.well-known/openid-configuration`] = { status: 200, data: { issuer: 'https://pf.test:9031' } };
    const res = await pre(pfSession(), { step: 'issue' });
    expect(check(res, 'issuer')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringContaining('https://pf.test:9031') }));
  });

  it('fails redeem when the resource AS token endpoint is unreachable', async () => {
    delete net[`${AS}/token`];
    const res = await pre(pfSession({ idJagPlayground: { idJag: idJag() } }), { step: 'redeem' });
    expect(check(res, 'resource-as')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringContaining('pf_id_jag_redemption_token_endpoint') }));
  });

  it('caches live probes for 30 s, and fresh=1 bypasses the cache', async () => {
    await pre(pfSession(), { step: 'issue' });
    await pre(pfSession(), { step: 'issue' });
    const wellKnown = () => axios.get.mock.calls.filter(([u]) => u.endsWith('/.well-known/openid-configuration')).length;
    expect(wellKnown()).toBe(1);
    await pre(pfSession(), { step: 'issue', fresh: '1' });
    expect(wellKnown()).toBe(2);
    const t = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(t + 31000);
    await pre(pfSession(), { step: 'issue' });
    expect(wellKnown()).toBe(3);
  });

  it('does not cache an unreachable host, so a re-check sees it come back', async () => {
    delete net[`${PF}/.well-known/openid-configuration`];
    expect(check(await pre(pfSession(), { step: 'issue' }), 'issuer').status).toBe('fail');
    net[`${PF}/.well-known/openid-configuration`] = { status: 200, data: { issuer: PF } };
    expect(check(await pre(pfSession(), { step: 'issue' }), 'issuer').status).toBe('pass');
  });
});

describe('preflight — the ID-JAG and the access token', () => {
  it('fails redeem with no ID-JAG, an already-redeemed one, or an expired one', async () => {
    expect(check(await pre(pfSession(), { step: 'redeem' }), 'id-jag')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/Request ID-JAG/) }));
    const used = await pre(pfSession({ idJagPlayground: { idJag: idJag(), redeemed: true } }), { step: 'redeem' });
    expect(check(used, 'id-jag')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringMatching(/already redeemed/), fix: expect.stringMatching(/Request a new ID-JAG/) }));
    const old = await pre(pfSession({ idJagPlayground: { idJag: idJag({ iat: now() - 400, exp: now() - 100 }) } }), { step: 'redeem' });
    expect(check(old, 'id-jag')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringMatching(/expired/), fix: expect.stringMatching(/Request a new ID-JAG/) }));
  });

  it('passes a live ID-JAG with the seconds left, and warns (without blocking) on an 1800 s lifetime', async () => {
    const res = await pre(pfSession({ idJagPlayground: { idJag: idJag({ exp: now() + 1800 }) } }), { step: 'redeem' });
    expect(check(res, 'id-jag')).toEqual(expect.objectContaining({ status: 'pass', detail: expect.stringMatching(/\d+ s left/) }));
    expect(check(res, 'lifetime')).toEqual(expect.objectContaining({ status: 'warn', detail: expect.stringContaining('1800 s') }));
    expect(res.body.ok).toBe(true);
  });

  it('checks the requested redeem scope is in the ID-JAG', async () => {
    const session = pfSession({ idJagPlayground: { idJag: idJag({ scope: 'openid mcp:read mcp:write' }) } });
    expect(check(await pre(session, { step: 'redeem' }), 'scope').status).toBe('pass');
    expect(check(await pre(session, { step: 'redeem', scope: 'mcp:read' }), 'scope').status).toBe('pass');
    const bad = await pre(session, { step: 'redeem', scope: 'admin:delete' });
    expect(check(bad, 'scope')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringContaining('admin:delete') }));
  });

  it('fails call with no access token or an expired one', async () => {
    expect(check(await pre(pfSession({ idJagPlayground: { idJag: idJag() } }), { step: 'call' }), 'access-token').status).toBe('fail');
    const old = await pre(pfSession({ idJagPlayground: { idJag: idJag(), accessToken: jwt({ exp: now() - 5 }) } }), { step: 'call' });
    expect(check(old, 'access-token')).toEqual(expect.objectContaining({ status: 'fail', detail: expect.stringMatching(/expired/) }));
    const ok = await pre(pfSession({ idJagPlayground: { idJag: idJag(), accessToken: jwt({ exp: now() + 60 }) } }), { step: 'call' });
    expect(check(ok, 'access-token').status).toBe('pass');
  });
});

describe('preflight — pf-pf', () => {
  beforeEach(() => {
    process.env.PF_IDJAG_ISSUER_PF_URL = SE;
    process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'redeemer-secret-value';
  });
  const pfPf = (over = {}) => ({ idJagPlaygroundMode: 'pf-pf', idJagIssuer: { refreshToken: 'se-rt-secret' }, idJagPlayground: { idJag: idJag({ iss: SE, aud: PF }) }, ...over });

  it('passes a healthy redeem step', async () => {
    const res = await pre(pfPf(), { step: 'redeem' });
    expect(res.body.checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/se-rt-secret|redeemer-secret-value/);
  });

  it('warns that the PingFederate redeemer may pick the wrong key when the issuer JWKS has several RSA keys', async () => {
    net[`${SE}/pf/JWKS`] = { status: 200, data: { keys: [RSA1, RSA2] } };
    const res = await pre(pfPf(), { step: 'redeem' });
    expect(check(res, 'jwks')).toEqual(expect.objectContaining({ status: 'warn', detail: expect.stringContaining('PingFederate redeemer may pick the wrong key') }));
    expect(check(res, 'jwks').fix).toMatch(/single-key JWKS/);
    expect(res.body.ok).toBe(true);
  });

  it('fails without the redeemer secret or the issuer sign-in', async () => {
    delete process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET;
    const res = await pre(pfPf({ idJagIssuer: undefined }), { step: 'redeem' });
    expect(check(res, 'redeemer-secret')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringContaining('PF_IDJAG_PF_REDEEMER_CLIENT_SECRET') }));
    expect(check(res, 'signed-in')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/issuer PingFederate/) }));
  });

  it('does not need the app login provider to be PingFederate', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    expect(check(await pre(pfPf(), { step: 'issue' }), 'provider')).toBeUndefined();
  });
});

describe('preflight — protected resource', () => {
  const tokens = () => pfSession({ idJagPlayground: { idJag: idJag(), redeemed: true, accessToken: jwt({ exp: now() + 60 }) } });

  it('passes when oauth-mcp serves /protected/profile (401 without a token) and the access token is live', async () => {
    net[`${AS}/protected/profile`] = { status: 401, data: {} };
    const res = await pre(tokens(), { step: 'resource', variant: 'token' });
    expect(res.body.checks.filter((c) => c.status !== 'pass')).toEqual([]);
  });

  it('fails when oauth-mcp has no /protected/profile yet, and says to deploy it', async () => {
    net[`${AS}/protected/profile`] = { status: 404, data: '' };
    const res = await pre(tokens(), { step: 'resource', variant: 'token' });
    expect(check(res, 'resource')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/mcp-server/) }));
  });

  it('the token variant needs an access token; the no-token variant does not', async () => {
    net[`${AS}/protected/profile`] = { status: 401, data: {} };
    expect(check(await pre(pfSession(), { step: 'resource', variant: 'token' }), 'access-token').status).toBe('fail');
    expect((await pre(pfSession(), { step: 'resource', variant: 'no-token' })).body.ok).toBe(true);
  });

  it('warns in pf-pf that oauth-mcp will refuse a PingFederate-issued token at the issuer check', async () => {
    process.env.PF_IDJAG_ISSUER_PF_URL = SE;
    process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'x';
    net[`${AS}/protected/profile`] = { status: 401, data: {} };
    const res = await pre({ ...tokens(), idJagPlaygroundMode: 'pf-pf' }, { step: 'resource', variant: 'token' });
    expect(check(res, 'resource-issuer')).toEqual(expect.objectContaining({ status: 'warn' }));
  });
});

describe('preflight — mode switch and byo', () => {
  it('mode: fails a mode this server cannot run, with the reason as the fix', async () => {
    const res = await pre(pfSession(), { step: 'mode', mode: 'pf-pf' });
    expect(res.body.ok).toBe(false);
    expect(check(res, 'mode')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringContaining('PF_IDJAG_ISSUER_PF_URL') }));
    expect(check(res, 'provider')).toBeUndefined();
  });

  it('byo inspect: warns when no trusted IdP targets the chosen server', async () => {
    jest.spyOn(trustedIdps, 'list').mockReturnValue([]);
    const res = await pre({ idJagPlaygroundMode: 'byo' }, { step: 'issue', target: 'pingfederate' });
    expect(check(res, 'trusted-idp')).toEqual(expect.objectContaining({ status: 'warn', fix: expect.stringMatching(/Trusted IdPs/) }));
    expect(res.body.ok).toBe(true);
  });

  it('byo redeem: fails when the registry IdP is disabled for the chosen target', async () => {
    jest.spyOn(trustedIdps, 'findById').mockReturnValue({ id: 'partner', name: 'Partner', enabled: false, targets: ['oauth-mcp'], jwksUrl: `${PF}/pf/JWKS` });
    const session = { idJagPlaygroundMode: 'byo', idJagPlayground: { idJag: idJag(), byo: { target: 'oauth-mcp', idpId: 'partner' } } };
    const res = await pre(session, { step: 'redeem' });
    expect(check(res, 'trusted-idp')).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/Enable Partner for oauth-mcp/) }));
    expect(check(res, 'signed-in')).toBeUndefined();
  });
});
