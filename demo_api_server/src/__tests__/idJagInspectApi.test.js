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
