'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({ callToolViaGateway: jest.fn(), getMcpGatewayHttpUrl: () => 'https://gw.test' }));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));

const axios = require('axios');
const configStore = require('../../services/configStore');
const inspectApi = require('../../routes/idJagInspect');

const PF = 'https://pf.test';
const AS = 'https://mcp-as.test';
const CONFIG = {
  pf_issuer: PF, pf_jwks_uri: `${PF}/pf/JWKS`, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_id_jag_audience: AS,
  pf_id_jag_resource: `${AS}/mcp`, pf_id_jag_redemption_token_endpoint: `${AS}/token`, pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
  mcp_demo_gateway_url: 'https://gw.test',
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (header, claims) => `${b64(header)}.${b64(claims)}.c2ln`;
const now = () => Math.floor(Date.now() / 1000);
const idJag = (over = {}) => jwt({ alg: 'RS256', typ: 'oauth-id-jag+jwt' }, {
  iss: PF, sub: 'u1', aud: AS, client_id: 'demo-bff-mcp-client', jti: 'jti-1', iat: now(), exp: now() + 300, scope: 'mcp:invoke', ...over });
const idToken = (over = {}) => jwt({ alg: 'RS256' }, { iss: PF, sub: 'u1', aud: 'app', nonce: 'n', iat: now(), exp: now() + 300, ...over });
const accessToken = (over = {}) => jwt({ alg: 'RS256', typ: 'at+jwt' }, { iss: AS, sub: 'u1', aud: `${AS}/mcp`, scope: 'read', iat: now(), exp: now() + 300, ...over });
const SAML = '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" IssueInstant="2026-01-01T00:00:00Z"><saml:Issuer>https://idp.test</saml:Issuer>'
  + '<saml:Subject><saml:NameID>u1</saml:NameID></saml:Subject><saml:Conditions NotBefore="2026-01-01T00:00:00Z" NotOnOrAfter="2026-01-01T00:05:00Z"><saml:AudienceRestriction><saml:Audience>https://aud.test</saml:Audience></saml:AudienceRestriction></saml:Conditions></saml:Assertion>';
const ok = { ok: true, note: 'valid' };
const byId = (r, id) => r.checks.find((c) => c.id === id);

let registry = [];
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => (k === 'id_jag_trusted_idps' ? JSON.stringify(registry) : CONFIG[k]));
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
  registry = [];
});
afterEach(() => jest.restoreAllMocks());

describe('classify', () => {
  it('tells the token kinds apart', () => {
    expect(inspectApi.classify(idJag())).toBe('id-jag');
    expect(inspectApi.classify(idToken())).toBe('id-token');
    expect(inspectApi.classify(accessToken())).toBe('access-token');
    expect(inspectApi.classify(SAML)).toBe('saml');
    expect(inspectApi.classify(Buffer.from(SAML).toString('base64'))).toBe('saml');
    expect(inspectApi.classify('hello')).toBe('unknown');
  });
});

describe('checkToken', () => {
  it("checks an ID-JAG from the app's own PingFederate against settings", async () => {
    const r = await inspectApi.checkToken(idJag(), { verify: async () => ok });
    expect(r.type).toBe('id-jag');
    expect(r.checks.every((c) => c.status !== 'fail')).toBe(true);
    expect(byId(r, 'trusted-idp').status).toBe('pass');
  });

  it('checks an ID-JAG from a registered trusted IdP, and fails an unknown issuer without a signature check', async () => {
    registry = [{ id: 'acme', name: 'Acme', issuer: 'https://acme.test', jwksUrl: 'https://acme.test/jwks', enabled: true,
      targets: ['oauth-mcp'], clientId: 'demo-bff-mcp-client', idJagClientId: 'agent-1', scopes: 'mcp:invoke' }];
    const good = await inspectApi.checkToken(idJag({ iss: 'https://acme.test', client_id: 'agent-1' }), { verify: async () => ok });
    expect(byId(good, 'trusted-idp').status).toBe('pass');
    expect(byId(good, 'client_id').status).toBe('pass');
    const verify = jest.fn();
    const bad = await inspectApi.checkToken(idJag({ iss: 'https://other.test' }), { verify });
    expect(byId(bad, 'trusted-idp').status).toBe('fail');
    expect(byId(bad, 'signature').status).toBe('fail');
    expect(verify).not.toHaveBeenCalled();
  });

  it('checks ID tokens, access tokens and SAML assertions', async () => {
    const id = await inspectApi.checkToken(idToken({ exp: now() - 10 }));
    expect(id.type).toBe('id-token');
    expect(byId(id, 'exp').status).toBe('fail');
    expect(byId(id, 'signature').status).toBe('warn');
    const at = await inspectApi.checkToken(accessToken({ aud: undefined }));
    expect(byId(at, 'claim-aud').status).toBe('fail');
    const saml = await inspectApi.checkToken(SAML);
    expect(saml.assertion.issuer).toBe('https://idp.test');
    expect(byId(saml, 'saml-expiry').status).toBe('fail');
    expect(byId(saml, 'saml-signature').status).toBe('fail');
  });
});

describe('/decode, /discovery', () => {
  const app = (user) => { const a = express(); a.use((req, _res, next) => { req.user = user; next(); }); a.use('/api/id-jag-inspect', inspectApi.router); return a; };

  it('decodes a pasted token, rejects an empty one, and never echoes the raw token', async () => {
    const t = idToken();
    const good = await request(app()).post('/api/id-jag-inspect/decode').send({ token: t });
    expect(good.status).toBe(200);
    expect(good.body.type).toBe('id-token');
    expect(JSON.stringify(good.body)).not.toContain(t);
    expect((await request(app()).post('/api/id-jag-inspect/decode').send({})).status).toBe(400);
  });

  it('fetches each backend\'s metadata and reports the MCP profile fields; a down backend is an error row', async () => {
    axios.get.mockImplementation(async (url) => {
      if (String(url).includes('pf.test')) throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
      return { status: 200, data: String(url).includes('gw.test') ? { scopes_supported: ['read'] }
        : { authorization_grant_profiles_supported: ['urn:ietf:params:oauth:grant-profile:id-jag'] } };
    });
    const r = await request(app()).get('/api/id-jag-inspect/discovery');
    expect(r.body.backends.map((b) => b.id)).toEqual(['resource-as', 'pingfederate', 'mcp']);
    expect(r.body.backends[0].profileFields).toEqual({ authorization_grant_profiles_supported: true, scopes_supported: false });
    expect(r.body.backends[1].error).toBe('ECONNREFUSED');
    expect(r.body.backends[2].profileFields.scopes_supported).toBe(true);
    expect(axios.get.mock.calls.every(([u]) => String(u).includes('.well-known'))).toBe(true);
  });
});

describe('POST /issued-token (reveal the ID-JAG this session minted)', () => {
  // session: what the playground stored when it minted; user: set by authenticateToken in the real mount
  const app = (user, session) => { const a = express(); a.use((req, _res, next) => { req.user = user; req.session = session; next(); }); a.use('/api/id-jag-inspect', inspectApi.router); return a; };
  const USER = { id: 'u1' };

  it("returns this session's minted ID-JAG, no-store", async () => {
    const t = idJag();
    const r = await request(app(USER, { idJagPlayground: { idJag: t, issuedAt: 1 } })).post('/api/id-jag-inspect/issued-token');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ token: t });
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('never takes the token from the request and never returns another session\'s token', async () => {
    const mine = idJag({ jti: 'mine' });
    const r = await request(app(USER, { idJagPlayground: { idJag: mine, issuedAt: 1 } })).post('/api/id-jag-inspect/issued-token').send({ token: idJag({ jti: 'theirs' }), idJag: 'x' });
    expect(r.body.token).toBe(mine);
    const other = await request(app(USER, {})).post('/api/id-jag-inspect/issued-token').send({ token: mine });
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain(mine);
  });

  it('401 when signed out', async () => {
    const r = await request(app(undefined, { idJagPlayground: { idJag: idJag(), issuedAt: 1 } })).post('/api/id-jag-inspect/issued-token');
    expect(r.status).toBe(401);
    expect(r.body.token).toBeUndefined();
  });

  it('404 with a plain message when nothing was minted', async () => {
    const r = await request(app(USER, {})).post('/api/id-jag-inspect/issued-token');
    expect(r.status).toBe(404);
    expect(r.body.message).toMatch(/Get an ID-JAG first/);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('writes the token to no log', async () => {
    const t = idJag({ jti: 'secret-jti' });
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    await request(app(USER, { idJagPlayground: { idJag: t, issuedAt: 1 } })).post('/api/id-jag-inspect/issued-token');
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(t);
  });
});

describe('POST /issued-check (the ID-JAG this session minted, trusted via the playground mode)', () => {
  const SE = 'https://se-pf.test';
  const app = (session) => { const a = express(); a.use((req, _res, next) => { req.user = { id: 'u1' }; req.session = session; next(); }); a.use('/api/id-jag-inspect', inspectApi.router); return a; };
  const check = (session) => request(app(session)).post('/api/id-jag-inspect/issued-check');
  beforeEach(() => {
    process.env.PF_IDJAG_ISSUER_PF_URL = SE;
    axios.get.mockRejectedValue(new Error('jwks offline'));
  });
  afterEach(() => { delete process.env.PF_IDJAG_ISSUER_PF_URL; });

  it('oauth-mcp mode: trusts the app PingFederate issuer, by name, and never returns the token', async () => {
    const t = idJag();
    const r = await check({ idJagPlayground: { idJag: t, issuedAt: 1 } });
    expect(r.status).toBe(200);
    expect(r.body.type).toBe('id-jag');
    expect(byId(r.body, 'trusted-idp')).toEqual(expect.objectContaining({ status: 'pass', actual: 'PingFederate' }));
    expect(r.body.idp.name).toBe('PingFederate');
    expect(JSON.stringify(r.body)).not.toContain(t);
  });

  it('pf-pf mode: trusts the SE PingFederate issuer (not a false failure) and checks against that mode', async () => {
    const t = jwt({ alg: 'RS256', typ: 'oauth-id-jag+jwt', x5t: 'thumb' }, { iss: SE, sub: 'u1', aud: PF, client_id: 'ai-demo-pf-idjag-redeemer', jti: 'j', iat: now(), exp: now() + 300, scope: 'mcp:invoke' });
    const r = await check({ idJagPlaygroundMode: 'pf-pf', idJagPlayground: { idJag: t, issuedAt: 1 } });
    expect(byId(r.body, 'trusted-idp')).toEqual(expect.objectContaining({ status: 'pass', actual: 'PingFederate (SE, issuer)' }));
    expect(byId(r.body, 'iss').status).toBe('pass');
    expect(byId(r.body, 'aud').status).toBe('pass');
    expect(byId(r.body, 'client_id').status).toBe('pass');
    expect(axios.get.mock.calls.map(([u]) => u)).toContain(`${SE}/pf/JWKS`);
  });

  it('an issuer the mode does not know still fails', async () => {
    for (const session of [{}, { idJagPlaygroundMode: 'pf-pf' }]) {
      const r = await check({ ...session, idJagPlayground: { idJag: idJag({ iss: 'https://evil.test' }), issuedAt: 1 } });
      expect(byId(r.body, 'trusted-idp').status).toBe('fail');
    }
  });

  it("falls back to the registry when the mode's own issuer does not match", async () => {
    registry = [{ id: 'acme', name: 'Acme IdP', issuer: 'https://acme.test', jwksUrl: 'https://acme.test/jwks', idJagClientId: 'acme-client', targets: ['oauth-mcp'], enabled: true }];
    const r = await check({ idJagPlayground: { idJag: idJag({ iss: 'https://acme.test' }), issuedAt: 1 } });
    expect(byId(r.body, 'trusted-idp')).toEqual(expect.objectContaining({ status: 'pass', actual: 'Acme IdP' }));
  });

  it('404 when nothing is minted, 401 when signed out', async () => {
    expect((await check({})).status).toBe(404);
    const a = express(); a.use((req, _res, next) => { req.session = { idJagPlayground: { idJag: idJag(), issuedAt: 1 } }; next(); }); a.use('/x', inspectApi.router);
    expect((await request(a).post('/x/issued-check')).status).toBe(401);
  });
});
