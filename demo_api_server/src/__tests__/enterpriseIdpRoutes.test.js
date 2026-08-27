'use strict';

jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  checkPolicy: jest.fn(),
  getAllowedResourceUris: jest.fn(() => ['https://mcpserver.ping.demo']),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const policy = require('../../services/enterpriseMcpPolicyService');
const configStore = require('../../services/configStore');
const keyMod = require('../../services/enterpriseIdpKey');

// Required at module scope, NOT lazily inside the helper: this repo's global
// setup.js afterEach calls jest.resetModules(), so a require() inside the
// helper would hand back a fresh router bound to a fresh policy module while
// this file still held the original mock — and checkPolicy would read as
// undefined from the second test onwards.
const enterpriseIdpRouter = require('../../routes/enterpriseIdp');

const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

function appWithSession(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/enterprise-idp', enterpriseIdpRouter);
  return app;
}

const VALID_BODY = {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
  subject_token: 'the-users-id-token',
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  audience: AS_ISSUER,
  resource: RESOURCE,
  scope: 'banking:read',
};

describe('enterprise IdP routes', () => {
  const session = { user: { oauthId: 'user-123', username: 'alice', email: 'alice@example.com' } };

  beforeEach(() => {
    jest.clearAllMocks();
    keyMod.resetForTests();
    policy.checkPolicy.mockResolvedValue({ allowed: true, matchDetail: 'group:banking-agents' });
    policy.getAllowedResourceUris.mockReturnValue([RESOURCE]);
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'enterprise_idp_issuer') return 'https://idp.ping.demo';
      if (k === 'enterprise_mcp_as_token_url') return `${AS_ISSUER}/token`;
      return '';
    });
  });

  test('GET /jwks publishes the signing key and no private material', async () => {
    const res = await request(appWithSession(session)).get('/api/enterprise-idp/jwks');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].alg).toBe('RS256');
    expect(res.body.keys[0].d).toBeUndefined();
  });

  test('mints an ID-JAG with the spec-mandated header and claims', async () => {
    const res = await request(appWithSession(session)).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(res.body.token_type).toBe('N_A');

    const decoded = jwt.decode(res.body.access_token, { complete: true });
    expect(decoded.header.typ).toBe('oauth-id-jag+jwt');
    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBe(keyMod.getKid());
    expect(decoded.payload.iss).toBe('https://idp.ping.demo');
    expect(decoded.payload.sub).toBe('user-123');
    expect(decoded.payload.email).toBe('alice@example.com');
    expect(decoded.payload.aud).toBe(AS_ISSUER);
    expect(decoded.payload.resource).toBe(RESOURCE);
    expect(decoded.payload.scope).toBe('banking:read');
    expect(decoded.payload.jti).toBeTruthy();
    expect(decoded.payload.exp - decoded.payload.iat).toBe(120);
  });

  test('DENY mints NOTHING and reports enterprise_mcp_policy_denied', async () => {
    policy.checkPolicy.mockResolvedValue({
      allowed: false, code: 'enterprise_mcp_policy_denied', httpStatus: 403, message: 'Not authorized.',
    });
    const res = await request(appWithSession(session)).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access_denied');
    expect(res.body.code).toBe('enterprise_mcp_policy_denied');
    expect(res.body.access_token).toBeUndefined();
  });

  test('rejects a resource outside the allowed set', async () => {
    const res = await request(appWithSession(session))
      .post('/api/enterprise-idp/token')
      .send({ ...VALID_BODY, resource: 'https://evil.example' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_target');
  });

  test('rejects a wrong requested_token_type', async () => {
    const res = await request(appWithSession(session))
      .post('/api/enterprise-idp/token')
      .send({ ...VALID_BODY, requested_token_type: 'urn:ietf:params:oauth:token-type:access_token' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('without a session, falls back to external-bearer auth and rejects for missing client credentials', async () => {
    // No req.session.user AND no client_id/client_secret in the body: this is
    // the "requires a signed-in session" case for the BFF's own orchestrated
    // callers, but since VALID_BODY carries a subject_token, it's now also a
    // (failed) external-bearer attempt — see enterpriseIdpTokenExternal.test.js
    // for the session-less success path.
    const res = await request(appWithSession({})).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
    expect(res.body.access_token).toBeUndefined();
  });

  test('policy is never consulted for an unapproved resource', async () => {
    await request(appWithSession(session))
      .post('/api/enterprise-idp/token')
      .send({ ...VALID_BODY, resource: 'https://evil.example' });
    expect(policy.checkPolicy).not.toHaveBeenCalled();
  });

  test('finding #62: an internal throw (e.g. malformed signing key) returns a 500, not a hang', async () => {
    const spy = jest.spyOn(keyMod, 'getPrivateKeyPem').mockImplementationOnce(() => {
      throw new Error('malformed PEM');
    });
    const res = await request(appWithSession(session)).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_error');
    spy.mockRestore();
  });
});
