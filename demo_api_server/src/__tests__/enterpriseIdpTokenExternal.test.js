'use strict';

jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  checkPolicy: jest.fn(),
  getAllowedResourceUris: jest.fn(() => []),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const policy = require('../../services/enterpriseMcpPolicyService');
const configStore = require('../../services/configStore');
const keyMod = require('../../services/enterpriseIdpKey');
const clientRegistry = require('../../services/enterpriseIdpClientRegistry');
const authStore = require('../../services/enterpriseIdpAuthStore');
// Module-scope require — global setup.js afterEach calls jest.resetModules().
const enterpriseIdpRouter = require('../../routes/enterpriseIdp');

const ISSUER = 'https://api.ping.demo:3001';
const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const CLIENT_ID = 'inspector-client';
const CLIENT_SECRET = 'inspector-secret';
const REDIRECT_URI = 'http://127.0.0.1:6274/oauth/callback';

function appNoSession() {
  const a = express();
  a.use(express.json());
  a.use('/api/enterprise-idp', enterpriseIdpRouter);
  return a;
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Mints an ID token the way our own /token(authorization_code) does, for
 * tests that need "a previously issued ID token" without a live /authorize
 * round trip. */
function signOwnIdToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 1800, ...claims },
    keyMod.getPrivateKeyPem(),
    { algorithm: 'RS256', header: { alg: 'RS256', kid: keyMod.getKid() } },
  );
}

describe('POST /token grant_type=authorization_code (EMA leg 1 completion)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    keyMod.resetForTests();
    clientRegistry.resetForTests();
    authStore.resetForTests();
    clientRegistry.registerClient({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uris: [REDIRECT_URI] });
    configStore.getEffective.mockImplementation((k) => (k === 'enterprise_idp_issuer' ? ISSUER : ''));
  });

  function issueCode(overrides) {
    const { verifier, challenge } = pkcePair();
    const code = authStore.createCode({
      clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: 'openid', codeChallenge: challenge,
      codeChallengeMethod: 'S256', subject: 'pingone-user-1', email: 'demo@example.com', ...overrides,
    });
    return { code, verifier };
  }

  test('400 invalid_grant for an unknown or expired code', async () => {
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').type('form').send({
      grant_type: 'authorization_code', code: 'never-issued', redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: 'anything',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('400 invalid_grant when code_verifier does not match the stored code_challenge', async () => {
    const { code } = issueCode();
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').type('form').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: 'wrong-verifier',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('400 invalid_client for a wrong client_secret', async () => {
    const { code, verifier } = issueCode();
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').type('form').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, client_secret: 'wrong-secret', code_verifier: verifier,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  test('response includes access_token as a string (RFC 6749 requires it alongside id_token)', async () => {
    const { code, verifier } = issueCode();
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').type('form').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: verifier,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.access_token.length).toBeGreaterThan(0);
  });

  test('mints a self-signed ID token for the resolved subject', async () => {
    const { code, verifier } = issueCode();
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').type('form').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: verifier,
    });
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');

    const payload = jwt.decode(res.body.id_token);
    expect(payload.iss).toBe(ISSUER);
    expect(payload.sub).toBe('pingone-user-1');
    expect(payload.email).toBe('demo@example.com');
    expect(payload.aud).toBe(CLIENT_ID);
  });
});

describe('POST /token grant_type=token-exchange, external bearer subject_token (EMA leg 2)', () => {
  const VALID_BODY_BASE = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    audience: AS_ISSUER,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    keyMod.resetForTests();
    clientRegistry.resetForTests();
    clientRegistry.registerClient({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uris: [REDIRECT_URI] });
    policy.checkPolicy.mockResolvedValue({ allowed: true, matchDetail: 'group:banking-agents' });
    policy.getAllowedResourceUris.mockReturnValue([]);
    configStore.getEffective.mockImplementation((k) => (k === 'enterprise_idp_issuer' ? ISSUER : ''));
  });

  test('400 invalid_request when subject_token is absent (unchanged request-shape validation)', async () => {
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').send({ ...VALID_BODY_BASE, subject_token: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('400 invalid_grant for a subject_token with a bad signature', async () => {
    const forged = signOwnIdToken({ sub: 'attacker' }).replace(/\.[^.]+$/, '.forged-signature');
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').send({ ...VALID_BODY_BASE, subject_token: forged });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('400 invalid_client when client_id/client_secret are missing', async () => {
    const idToken = signOwnIdToken({ sub: 'pingone-user-1' });
    const { client_id, client_secret, ...body } = VALID_BODY_BASE;
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').send({ ...body, subject_token: idToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  test('mints an ID-JAG from the subject_token claims when no session is present', async () => {
    const idToken = signOwnIdToken({ sub: 'pingone-user-1', email: 'demo@example.com' });
    const res = await request(appNoSession()).post('/api/enterprise-idp/token').send({ ...VALID_BODY_BASE, subject_token: idToken });
    expect(res.status).toBe(200);

    const decoded = jwt.decode(res.body.access_token);
    expect(decoded.sub).toBe('pingone-user-1');
    expect(decoded.email).toBe('demo@example.com');
    expect(decoded.aud).toBe(AS_ISSUER);
  });

  test('policy is still consulted for an externally-presented subject_token', async () => {
    const idToken = signOwnIdToken({ sub: 'pingone-user-1' });
    await request(appNoSession()).post('/api/enterprise-idp/token').send({ ...VALID_BODY_BASE, subject_token: idToken });
    expect(policy.checkPolicy).toHaveBeenCalledTimes(1);
  });
});
