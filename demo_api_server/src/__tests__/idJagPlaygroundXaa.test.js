'use strict';

/**
 * ID-JAG playground: xaa.dev's IdenX as a real outside IdP for the byo mode.
 * IdenX sign-in (code + PKCE + nonce) -> RFC 8693 ID-JAG exchange at IdenX -> the byo inspect
 * path -> redeem at oauth-mcp as our xaa client (client_secret_post). Tokens stay server-side.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));
// jose is ESM-only (jest maps it to a CJS shim). This double does real RS256 with node:crypto
// and honours jwtVerify's issuer/audience/algorithms options, so the route's checks are real.
jest.mock('jose', () => {
  const nodeCrypto = jest.requireActual('crypto');
  return {
    createLocalJWKSet: (jwks) => jwks,
    jwtVerify: async (token, jwks, opts = {}) => {
      const [h, p, s] = String(token).split('.');
      const header = JSON.parse(Buffer.from(h, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (opts.algorithms && !opts.algorithms.includes(header.alg)) throw new Error('alg not allowed');
      const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
      if (!jwk) throw new Error('no matching key');
      const ok = nodeCrypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), nodeCrypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
      if (!ok) throw new Error('signature verification failed');
      if (opts.issuer && payload.iss !== opts.issuer) throw new Error('unexpected "iss" claim value');
      if (opts.audience && payload.aud !== opts.audience) throw new Error('unexpected "aud" claim value');
      if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) throw new Error('"exp" claim timestamp check failed');
      return { payload, protectedHeader: header };
    },
  };
});

const axios = require('axios');
const configStore = require('../../services/configStore');
const router = require('../../routes/idJagPlayground');

const IDENX = 'https://idp.xaa.dev';
const AS = 'https://mcp-as.test';
const DISCOVERY = {
  issuer: IDENX, authorization_endpoint: `${IDENX}/authorize`, token_endpoint: `${IDENX}/token`, jwks_uri: `${IDENX}/jwks`,
};
const XAA_ENTRY = {
  id: 'xaa-dev', name: 'xaa.dev IdenX', issuer: IDENX, jwksUrl: `${IDENX}/jwks`, idJagClientId: 'xaa-at-oauth-mcp',
  clientId: 'xaa-at-oauth-mcp', pfClientId: 'ai-demo-pf-idjag-redeemer', scopes: 'read', targets: ['oauth-mcp'], enabled: true,
};
const ENV = {
  XAA_DEV_IDP_CLIENT_ID: 'idenx-app', XAA_DEV_IDP_CLIENT_SECRET: 'idenx-app-secret',
  XAA_DEV_OUR_AS_CLIENT_ID: 'xaa-at-oauth-mcp', XAA_DEV_OUR_AS_CLIENT_SECRET: 'xaa-as-secret',
};
let CONFIG;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'idenx-1', alg: 'RS256', use: 'sig' }] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function signRs256(claims, kid = 'idenx-1', typ = 'JWT') {
  const input = `${b64({ alg: 'RS256', kid, typ })}.${b64(claims)}`;
  return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
const idToken = (over = {}) => signRs256({ iss: IDENX, aud: 'idenx-app', sub: 'idenx-user-1', email: 'alice@example.com', nonce: 'n-1', iat: now(), exp: now() + 300, ...over });
const xaaIdJag = (over = {}) => signRs256({
  iss: IDENX, sub: 'idenx-user-1', aud: AS, client_id: 'xaa-at-oauth-mcp', jti: 'xj1', iat: now(), exp: now() + 300,
  resource: `${AS}/mcp`, scope: 'read', ...over,
}, 'idenx-1', 'oauth-id-jag+jwt');
const accessToken = `${b64({ alg: 'RS256' })}.${b64({ iss: AS, sub: 'idenx-user-1', scope: 'read' })}.c2ln`;

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const byoSession = (extra = {}) => ({ idJagPlaygroundMode: 'byo', save: (cb) => cb(), ...extra });
const signedInSession = (tokens = { refreshToken: 'idenx-rt', idToken: 'idenx-idt' }) => byoSession({ idJagXaa: { ...tokens, sub: 'idenx-user-1', email: 'alice@example.com' } });
const post = (app, path, body) => request(app).post(path).set('Origin', 'https://app.test').send(body || {});
const form = (call) => new URLSearchParams(call[1]);

beforeEach(() => {
  jest.clearAllMocks();
  router._clearProbeCache();
  router._resetXaaDiscovery();
  Object.assign(process.env, ENV);
  CONFIG = {
    pf_id_jag_enabled: 'true', pf_id_jag_audience: AS, pf_id_jag_resource: `${AS}/mcp`,
    pf_id_jag_redemption_token_endpoint: 'http://mcp-server:8080/token', pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
    pf_id_jag_redemption_client_secret: 'redeem-secret', id_jag_trusted_idps: JSON.stringify([XAA_ENTRY]),
  };
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[String(k).toLowerCase()]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
  axios.get.mockImplementation(async (url) => {
    if (url === `${IDENX}/.well-known/openid-configuration`) return { status: 200, data: DISCOVERY };
    if (url === `${IDENX}/jwks`) return { status: 200, data: JWKS };
    return { status: 200, data: { keys: [] } };
  });
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  jest.restoreAllMocks();
});

describe('xaa.dev sign-in at IdenX', () => {
  it('login redirects to IdenX (from discovery) with PKCE S256, state, nonce and offline_access; the verifier stays in the session', async () => {
    const session = byoSession();
    const res = await request(appWith(session)).get('/pg/xaa/login?return_to=/pingfederate-id-jag/playground');
    expect(res.status).toBe(302);
    const to = new URL(res.headers.location);
    expect(to.origin + to.pathname).toBe(`${IDENX}/authorize`);
    const q = Object.fromEntries(to.searchParams);
    expect(q).toEqual(expect.objectContaining({
      response_type: 'code', client_id: 'idenx-app', redirect_uri: 'https://app.test/api/id-jag-playground/xaa/callback',
      scope: 'openid profile email offline_access', prompt: 'consent', code_challenge_method: 'S256',
    }));
    const pending = session.idJagXaaLogin;
    expect(q.state).toBe(pending.state);
    expect(q.nonce).toBe(pending.nonce);
    expect(q.code_challenge).toBe(crypto.createHash('sha256').update(pending.verifier).digest('base64url'));
    expect(res.headers.location).not.toContain(pending.verifier);
    expect(res.headers.location).not.toContain('idenx-app-secret');
  });

  it('callback swaps the code (PKCE verifier, client_secret_post), verifies the id_token and keeps the tokens server-side', async () => {
    const session = byoSession({ idJagXaaLogin: { state: 's-1', nonce: 'n-1', verifier: 'v-1', returnTo: '/pingfederate-id-jag/playground', at: Date.now() } });
    axios.post.mockResolvedValue({ status: 200, data: { id_token: idToken(), refresh_token: 'idenx-rt', access_token: 'idenx-at' } });
    const res = await request(appWith(session)).get('/pg/xaa/callback?code=c-1&state=s-1');
    expect(res.headers.location).toBe('/pingfederate-id-jag/playground?xaa=signed_in');
    const [url] = axios.post.mock.calls[0];
    expect(url).toBe(`${IDENX}/token`);
    expect(Object.fromEntries(form(axios.post.mock.calls[0]))).toEqual({
      grant_type: 'authorization_code', code: 'c-1', redirect_uri: 'https://app.test/api/id-jag-playground/xaa/callback',
      code_verifier: 'v-1', client_id: 'idenx-app', client_secret: 'idenx-app-secret',
    });
    expect(session.idJagXaa).toEqual(expect.objectContaining({ refreshToken: 'idenx-rt', sub: 'idenx-user-1', email: 'alice@example.com' }));
    expect(session.idJagXaaLogin).toBeUndefined();
  });

  it('callback with the wrong state is refused before any token call', async () => {
    const session = byoSession({ idJagXaaLogin: { state: 's-1', nonce: 'n-1', verifier: 'v-1', returnTo: '/pingfederate-id-jag/playground', at: Date.now() } });
    const res = await request(appWith(session)).get('/pg/xaa/callback?code=c-1&state=evil');
    expect(res.headers.location).toContain('xaa_error=invalid_state');
    expect(axios.post).not.toHaveBeenCalled();
    expect(session.idJagXaa).toBeUndefined();
  });

  it.each([
    ['a nonce mismatch', { nonce: 'other' }],
    ['another audience', { aud: 'someone-else' }],
  ])('callback refuses an id_token with %s', async (_n, over) => {
    const session = byoSession({ idJagXaaLogin: { state: 's-1', nonce: 'n-1', verifier: 'v-1', returnTo: '/pingfederate-id-jag/playground', at: Date.now() } });
    axios.post.mockResolvedValue({ status: 200, data: { id_token: idToken(over), refresh_token: 'idenx-rt' } });
    const res = await request(appWith(session)).get('/pg/xaa/callback?code=c-1&state=s-1');
    expect(res.headers.location).toContain('xaa_error=invalid_id_token');
    expect(session.idJagXaa).toBeUndefined();
  });
});

describe('xaa.dev ID-JAG exchange', () => {
  it('asks IdenX for an ID-JAG for our public issuer, then loads it like a pasted one (decoded claims only)', async () => {
    const session = signedInSession();
    const idJag = xaaIdJag();
    axios.post.mockResolvedValue({ status: 200, data: { access_token: idJag, issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag', token_type: 'N_A' } });
    const res = await post(appWith(session), '/pg/xaa/id-jag');
    expect(res.status).toBe(200);
    expect(axios.post.mock.calls[0][0]).toBe(`${IDENX}/token`);
    expect(Object.fromEntries(form(axios.post.mock.calls[0]))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
      subject_token: 'idenx-rt', subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
      audience: AS, resource: `${AS}/mcp`, scope: 'read', client_id: 'idenx-app', client_secret: 'idenx-app-secret',
    });
    expect(res.body.trusted).toBe(true);
    expect(res.body.idp).toEqual({ id: 'xaa-dev', name: 'xaa.dev IdenX' });
    expect(res.body.claims).toEqual(expect.objectContaining({ iss: IDENX, client_id: 'xaa-at-oauth-mcp', scope: 'read' }));
    const byId = Object.fromEntries(res.body.checks.map((c) => [c.id, c]));
    expect(byId.aud.status).toBe('pass');
    expect(byId.client_id.status).toBe('pass');
    expect(byId.resource.status).toBe('pass');
    expect(res.body.request.body).toEqual(expect.objectContaining({ subject_token: expect.stringMatching(/kept server-side/), audience: AS }));
    expect(session.idJagPlayground).toEqual(expect.objectContaining({ idJag, redeemed: false, byo: { target: 'oauth-mcp', idpId: 'xaa-dev' } }));
    const text = JSON.stringify(res.body);
    for (const secret of [idJag, 'idenx-rt', 'idenx-idt', 'idenx-app-secret', 'xaa-as-secret']) expect(text).not.toContain(secret);
  });

  it('falls back to the id_token when IdenX gave no refresh token', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { access_token: xaaIdJag() } });
    await post(appWith(signedInSession({ refreshToken: null, idToken: 'idenx-idt' })), '/pg/xaa/id-jag');
    const f = form(axios.post.mock.calls[0]);
    expect(f.get('subject_token')).toBe('idenx-idt');
    expect(f.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:id_token');
  });

  it('needs an IdenX sign-in first', async () => {
    const res = await post(appWith(byoSession()), '/pg/xaa/id-jag');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('xaa_sign_in_required');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('a refused refresh token ends the IdenX session so the next click signs in again', async () => {
    const session = signedInSession();
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_grant', error_description: 'grant request is invalid' } });
    const res = await post(appWith(session), '/pg/xaa/id-jag');
    expect(res.status).toBe(502);
    expect(res.body).toEqual(expect.objectContaining({ error: 'xaa_exchange_failed', idpError: 'invalid_grant' }));
    expect(session.idJagXaa).toBeUndefined();
  });

  it('redeems the xaa ID-JAG at oauth-mcp as our xaa client, secret in the body (client_secret_post)', async () => {
    const session = signedInSession();
    axios.post.mockResolvedValueOnce({ status: 200, data: { access_token: xaaIdJag() } });
    await post(appWith(session), '/pg/xaa/id-jag');
    axios.post.mockResolvedValueOnce({ status: 200, data: { access_token: accessToken, token_type: 'Bearer', scope: 'read' } });
    const red = await post(appWith(session), '/pg/redeem', {});
    expect(red.status).toBe(200);
    const [url, body, opts] = axios.post.mock.calls[1];
    expect(url).toBe('http://mcp-server:8080/token');
    const f = new URLSearchParams(body);
    expect(f.get('client_id')).toBe('xaa-at-oauth-mcp');
    expect(f.get('client_secret')).toBe('xaa-as-secret');
    expect(opts.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(red.body)).not.toContain('xaa-as-secret');
  });

  it('never sends the xaa secret when the entry names another client', async () => {
    CONFIG.id_jag_trusted_idps = JSON.stringify([{ ...XAA_ENTRY, clientId: 'someone-else' }]);
    const session = signedInSession();
    session.idJagPlayground = { idJag: xaaIdJag(), redeemed: false, byo: { target: 'oauth-mcp', idpId: 'xaa-dev' } };
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_client' } });
    await post(appWith(session), '/pg/redeem', {});
    expect(axios.post.mock.calls[0][1]).not.toContain('xaa-as-secret');
    expect(axios.post.mock.calls[0][2].headers.Authorization).toBeUndefined();
  });
});

describe('xaa.dev availability', () => {
  it('is offered in /config when the client is set and the oauth-mcp issuer is https', async () => {
    const res = await request(appWith(signedInSession())).get('/pg/config');
    expect(res.body.xaa).toEqual({ available: true, reason: null, signedIn: true, user: 'alice@example.com' });
  });

  it('is unavailable on an http issuer (local Docker), with the reason, and refuses login and exchange', async () => {
    CONFIG.pf_id_jag_audience = 'http://pf-mcp-server:8080';
    const session = signedInSession();
    const cfg = await request(appWith(session)).get('/pg/config');
    expect(cfg.body.xaa.available).toBe(false);
    expect(cfg.body.xaa.reason).toMatch(/hosted demo/);
    const login = await request(appWith(session)).get('/pg/xaa/login?return_to=/pingfederate-id-jag/playground');
    expect(login.headers.location).toBe('/pingfederate-id-jag/playground?xaa_error=unavailable');
    const ex = await post(appWith(session), '/pg/xaa/id-jag');
    expect(ex.status).toBe(409);
    expect(ex.body.error).toBe('xaa_unavailable');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('is unavailable without the IdenX client', async () => {
    delete process.env.XAA_DEV_IDP_CLIENT_SECRET;
    const res = await request(appWith(byoSession())).get('/pg/config');
    expect(res.body.xaa).toEqual(expect.objectContaining({ available: false, reason: expect.stringMatching(/XAA_DEV_IDP_CLIENT_SECRET/) }));
  });

  it('preflight: IdenX reachable, registry entry enabled for oauth-mcp, our client configured', async () => {
    const ok = await request(appWith(byoSession())).get('/pg/preflight?step=xaa&mode=byo');
    expect(ok.body.ok).toBe(true);
    expect(ok.body.checks.map((c) => [c.id, c.status])).toEqual(expect.arrayContaining([
      ['xaa-available', 'pass'], ['idenx', 'pass'], ['xaa-trusted-idp', 'pass'], ['xaa-client', 'pass'],
    ]));

    router._clearProbeCache();
    CONFIG.id_jag_trusted_idps = JSON.stringify([{ ...XAA_ENTRY, enabled: false }]);
    delete process.env.XAA_DEV_OUR_AS_CLIENT_SECRET;
    axios.get.mockImplementation(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); });
    const bad = await request(appWith(byoSession())).get('/pg/preflight?step=xaa&mode=byo');
    expect(bad.body.ok).toBe(false);
    const byId = Object.fromEntries(bad.body.checks.map((c) => [c.id, c]));
    expect(byId.idenx.status).toBe('fail');
    expect(byId['xaa-trusted-idp'].status).toBe('fail');
    expect(byId['xaa-client']).toEqual(expect.objectContaining({ status: 'fail', fix: expect.stringMatching(/XAA_DEV_OUR_AS_CLIENT_SECRET/) }));
    expect(JSON.stringify(bad.body)).not.toContain('idenx-app-secret');
  });
});
