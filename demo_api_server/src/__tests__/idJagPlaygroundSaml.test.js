'use strict';

// protocol:"saml" on /issue: the server signs an assertion for the signed-in user and PingFederate trades it for an ID-JAG.
// The signer is a throwaway generated per run; no PEM is committed.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const request = require('supertest');
const { DOMParser } = require('@xmldom/xmldom');

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
const router = require('../../routes/idJagPlayground');

const PF = 'https://pf.test';
const SE = 'https://se-pf.test';
const AS = 'https://mcp-as.test';
const SAML2 = 'urn:ietf:params:oauth:token-type:saml2';
const ID_JAG = 'urn:ietf:params:oauth:token-type:id-jag';
const SAML_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const CONFIG = {
  pf_issuer: PF, pf_jwks_uri: `${PF}/pf/JWKS`, pf_token_endpoint: `${PF}/as/token.oauth2`, pf_user_client_id: 'ai-demo-pf-user',
  pf_user_client_secret: 'user-secret',
  pf_id_jag_enabled: 'true', pf_id_jag_audience: AS, pf_id_jag_resource: `${AS}/mcp`, pf_id_jag_scope: 'mcp:invoke',
  pf_id_jag_redemption_token_endpoint: `${AS}/token`, pf_id_jag_redemption_client_id: 'demo-bff-mcp-client',
  pf_id_jag_redemption_client_secret: 'redeem-secret',
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (header, claims) => `${b64(header)}.${b64(claims)}.c2lnbmF0dXJl`;
const idJagToken = jwt({ alg: 'RS256', typ: 'oauth-id-jag+jwt' }, { iss: PF, sub: 'real.user@example.com', aud: AS, client_id: 'ai-demo-pf-saml', scope: 'mcp:invoke' });

let SIGNER;
beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-route-'));
  try {
    const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(path.join(dir, 'k.pem'), key, { mode: 0o600 });
    execFileSync('openssl', ['req', '-new', '-x509', '-key', path.join(dir, 'k.pem'), '-subj', '/CN=saml-route-test', '-days', '2', '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    SIGNER = { key: Buffer.from(key).toString('base64'), cert: Buffer.from(fs.readFileSync(path.join(dir, 'c.pem'))).toString('base64'), certPem: fs.readFileSync(path.join(dir, 'c.pem'), 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const appSession = (over = {}) => ({
  oauthProvider: 'pingfederate', oauthTokens: { refreshToken: 'rt-secret', idToken: 'idt' },
  user: { email: 'real.user@example.com' }, ...over,
});
const pfPfSession = (over = {}) => ({ idJagPlaygroundMode: 'pf-pf', idJagIssuer: { refreshToken: 'se-rt', email: 'se.user@example.com' }, ...over });
const post = (app, p, body) => request(app).post(p).set('Origin', 'https://app.test').send(body || {});
const assertionOf = (call) => Buffer.from(new URLSearchParams(call[1]).get('subject_token'), 'base64url').toString('utf8');
const nameIdOf = (xml) => new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(SAML_NS, 'NameID')[0].textContent;

const ENV_KEYS = ['SAML_SIGNING_KEY_PEM_B64', 'SAML_SIGNING_CERT_PEM_B64', 'PF_SAML_CLIENT_SECRET', 'PF_SAML_CLIENT_ID', 'SAML_ISSUER', 'SAML_AUDIENCE',
  'PF_IDJAG_ISSUER_PF_URL', 'PF_IDJAG_PF_REDEEMER_CLIENT_SECRET'];
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
  process.env.SAML_SIGNING_KEY_PEM_B64 = SIGNER.key;
  process.env.SAML_SIGNING_CERT_PEM_B64 = SIGNER.cert;
  process.env.PF_SAML_CLIENT_SECRET = 'saml-client-secret';
  process.env.PF_IDJAG_ISSUER_PF_URL = SE;
  process.env.PF_IDJAG_PF_REDEEMER_CLIENT_SECRET = 'redeemer-secret';
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('SAML ID-JAG — config block', () => {
  it('is available with signing material, and names the issuer, audience and modes', async () => {
    const res = await request(appWith(appSession())).get('/pg/config');
    expect(res.body.saml).toEqual({
      available: true, reason: null, audience: 'idJagDemoSamlAud', issuer: 'https://app.test/saml',
      supportedModes: ['oauth-mcp', 'pf-pf'], appSignedIn: true,
    });
  });

  it('honours SAML_ISSUER and SAML_AUDIENCE', async () => {
    process.env.SAML_ISSUER = 'https://issuer.test/saml';
    process.env.SAML_AUDIENCE = 'otherAud';
    const res = await request(appWith(appSession())).get('/pg/config');
    expect(res.body.saml).toEqual(expect.objectContaining({ issuer: 'https://issuer.test/saml', audience: 'otherAud' }));
  });

  it('is unavailable with a plain reason when the signing material is missing', async () => {
    delete process.env.SAML_SIGNING_KEY_PEM_B64;
    delete process.env.SAML_SIGNING_CERT_PEM_B64;
    const res = await request(appWith({})).get('/pg/config');
    expect(res.body.saml.available).toBe(false);
    expect(res.body.saml.reason).toMatch(/SAML_SIGNING_KEY_PEM_B64/);
    expect(res.body.saml.appSignedIn).toBe(false);
  });

  it('is unavailable when only half of the signer is set', async () => {
    delete process.env.SAML_SIGNING_CERT_PEM_B64;
    const res = await request(appWith({})).get('/pg/config');
    expect(res.body.saml).toEqual(expect.objectContaining({ available: false, reason: expect.stringMatching(/SAML_SIGNING_CERT_PEM_B64/) }));
  });

  it('is unavailable without the SAML client secret', async () => {
    delete process.env.PF_SAML_CLIENT_SECRET;
    const res = await request(appWith({})).get('/pg/config');
    expect(res.body.saml).toEqual(expect.objectContaining({ available: false, reason: expect.stringMatching(/PF_SAML_CLIENT_SECRET/) }));
  });

  it('never carries key material', async () => {
    const res = await request(appWith(appSession())).get('/pg/config');
    expect(JSON.stringify(res.body)).not.toContain(SIGNER.key);
    expect(JSON.stringify(res.body)).not.toContain('saml-client-secret');
  });
});

describe('SAML ID-JAG — pf-pf issuer sign-in keeps the email for the assertion subject', () => {
  it('stores the ID token email claim next to the refresh token', async () => {
    const session = { idJagPlaygroundMode: 'pf-pf', save: (cb) => cb() };
    const app = appWith(session);
    const login = await request(app).get('/pg/issuer/login?return_to=/pingfederate-id-jag/playground');
    const state = new URL(login.headers.location).searchParams.get('state');
    axios.post.mockResolvedValue({ status: 200, data: { refresh_token: 'se-rt', id_token: jwt({ alg: 'RS256' }, { sub: 'u1', email: 'se.user@example.com' }) } });
    await request(app).get(`/pg/issuer/callback?code=c1&state=${state}`);
    expect(session.idJagIssuer).toEqual({ refreshToken: 'se-rt', sub: 'u1', email: 'se.user@example.com' });
  });
});

describe('SAML ID-JAG — GET /saml/cert', () => {
  it('serves the signer certificate as PEM', async () => {
    const res = await request(appWith({})).get('/pg/saml/cert');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-pem-file/);
    expect(res.text).toContain('BEGIN CERTIFICATE');
    expect(res.text).not.toContain('PRIVATE KEY');
  });

  it('answers 404 saml_not_configured without signing material', async () => {
    delete process.env.SAML_SIGNING_KEY_PEM_B64;
    const res = await request(appWith({})).get('/pg/saml/cert');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('saml_not_configured');
  });
});

describe('SAML ID-JAG — POST /issue {protocol:"saml"}', () => {
  const ok = () => axios.post.mockResolvedValue({ status: 200, data: { access_token: idJagToken, issued_token_type: ID_JAG } });

  it('oauth-mcp: posts ONE SAML exchange to the app PingFederate as the SAML client, for the session user', async () => {
    ok();
    const session = appSession();
    const res = await post(appWith(session), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(oauthService.performIdJagExchange).not.toHaveBeenCalled();
    const [url, form, opts] = axios.post.mock.calls[0];
    expect(url).toBe(`${PF}/as/token.oauth2`);
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('ai-demo-pf-saml:saml-client-secret').toString('base64')}`);
    const p = new URLSearchParams(form);
    expect(p.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(p.get('subject_token_type')).toBe(SAML2);
    expect(p.get('requested_token_type')).toBe(ID_JAG);
    expect(p.get('audience')).toBe(AS);
    expect(p.get('resource')).toBe(`${AS}/mcp`);
    expect(p.get('scope')).toBe('mcp:invoke');
    expect(nameIdOf(assertionOf(axios.post.mock.calls[0]))).toBe('real.user@example.com');
    expect(session.idJagPlayground.idJag).toBe(idJagToken);
  });

  it('answers with the usual issue shape plus a masked assertion, never the raw one', async () => {
    ok();
    const res = await post(appWith(appSession()), '/pg/issue', { protocol: 'saml' });
    expect(res.body.request.body.subject_token_type).toBe(SAML2);
    expect(res.body.request.body.client_id).toBe('ai-demo-pf-saml');
    expect(res.body.response.issued_token_type).toBe(ID_JAG);
    expect(res.body.token.header.typ).toBe('oauth-id-jag+jwt');
    expect(res.body.assertion).toEqual(expect.objectContaining({ nameId: 'real.user@example.com', audience: 'idJagDemoSamlAud', issuer: 'https://app.test/saml' }));
    expect(res.body.assertion.xml).toContain('[…]');
    const raw = assertionOf(axios.post.mock.calls[0]);
    const sigValue = /<ds:SignatureValue>([^<]+)</.exec(raw)[1];
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(sigValue.slice(0, 40));
    expect(text).not.toContain(Buffer.from(raw).toString('base64url').slice(0, 60));
    expect(text).not.toContain(idJagToken);
    expect(text).not.toContain('saml-client-secret');
    expect(text).not.toContain('rt-secret');
  });

  it('pf-pf: exchanges at the SE PingFederate for the issuer-session email', async () => {
    ok();
    const res = await post(appWith(pfPfSession()), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, form] = axios.post.mock.calls[0];
    expect(url).toBe(`${SE}/as/token.oauth2`);
    expect(new URLSearchParams(form).get('subject_token_type')).toBe(SAML2);
    expect(new URLSearchParams(form).get('audience')).toBe(PF);
    expect(nameIdOf(assertionOf(axios.post.mock.calls[0]))).toBe('se.user@example.com');
    expect(res.body.assertion.nameId).toBe('se.user@example.com');
  });

  it('ignores subject, email and nameId in the body', async () => {
    ok();
    await post(appWith(appSession()), '/pg/issue', { protocol: 'saml', subject: 'evil@x.com', email: 'evil@x.com', nameId: 'evil@x.com', sub: 'evil@x.com' });
    expect(nameIdOf(assertionOf(axios.post.mock.calls[0]))).toBe('real.user@example.com');
    ok();
    axios.post.mockClear();
    await post(appWith(pfPfSession()), '/pg/issue', { protocol: 'saml', subject: 'evil@x.com', email: 'evil@x.com' });
    expect(nameIdOf(assertionOf(axios.post.mock.calls[0]))).toBe('se.user@example.com');
  });

  it('escapes XML metacharacters in the session email instead of injecting them', async () => {
    ok();
    const res = await post(appWith(appSession({ user: { email: 'a&b<c>"x@x.com' } })), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(200);
    const raw = assertionOf(axios.post.mock.calls[0]);
    expect(raw).not.toContain('<c>');
    expect(nameIdOf(raw)).toBe('a&b<c>"x@x.com');
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['without an @', 'not-an-address'],
    ['with whitespace', 'a b@x.com'],
    ['with a control character', 'a\u0000@x.com'],
  ])('refuses a session email that is %s with 403 and no exchange', async (_n, email) => {
    const res = await post(appWith(appSession({ user: { email } })), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('saml_subject_invalid');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refuses a pf-pf issuer session that has no email (signed in before the email was kept)', async () => {
    const res = await post(appWith(pfPfSession({ idJagIssuer: { refreshToken: 'se-rt' } })), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('saml_subject_invalid');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('byo -> 409 saml_unsupported_mode, no exchange', async () => {
    const res = await post(appWith(appSession({ idJagPlaygroundMode: 'byo' })), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('saml_unsupported_mode');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('no PingFederate sign-in -> 401 sign_in_required, no exchange', async () => {
    const res = await post(appWith({}), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('sign_in_required');
    const res2 = await post(appWith({ idJagPlaygroundMode: 'pf-pf' }), '/pg/issue', { protocol: 'saml' });
    expect(res2.status).toBe(401);
    expect(res2.body.error).toBe('sign_in_required');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('unset or half-set signer -> 409 saml_not_configured with the reason, no stack trace', async () => {
    delete process.env.SAML_SIGNING_KEY_PEM_B64;
    const res = await post(appWith(appSession()), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('saml_not_configured');
    expect(res.body.message).toMatch(/SAML_SIGNING_KEY_PEM_B64/);
    expect(JSON.stringify(res.body)).not.toMatch(/\bat \S+ \(/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('bad base64 in the signer -> 409 saml_not_configured', async () => {
    process.env.SAML_SIGNING_KEY_PEM_B64 = '!!!';
    const res = await post(appWith(appSession()), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('saml_not_configured');
  });

  it('PingFederate refusing the exchange surfaces the PF error through id_jag_issue_failed', async () => {
    axios.post.mockResolvedValue({ status: 400, data: { error: 'invalid_grant', error_description: 'Audience mismatch' } });
    const res = await post(appWith(appSession()), '/pg/issue', { protocol: 'saml' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'id_jag_issue_failed', pfError: 'invalid_grant', pfErrorDescription: 'Audience mismatch',
    }));
    expect(JSON.stringify(res.body)).not.toContain('saml-client-secret');
  });

  it('an unknown protocol is refused with 400, not treated as OIDC', async () => {
    const res = await post(appWith(appSession()), '/pg/issue', { protocol: 'ws-fed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_protocol');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('leaves the default OIDC path alone', async () => {
    oauthService.performIdJagExchange.mockResolvedValue(idJagToken);
    const res = await post(appWith(appSession()), '/pg/issue', {});
    expect(res.status).toBe(200);
    expect(oauthService.performIdJagExchange).toHaveBeenCalledTimes(1);
    expect(res.body.assertion).toBeUndefined();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin request before anything happens', async () => {
    const res = await request(appWith(appSession())).post('/pg/issue').set('Origin', 'https://evil.test').send({ protocol: 'saml' });
    expect(res.status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
