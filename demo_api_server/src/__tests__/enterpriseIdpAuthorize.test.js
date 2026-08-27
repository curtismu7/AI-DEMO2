'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const express = require('express');
const request = require('supertest');
const axios = require('axios');

const configStore = require('../../services/configStore');
const clientRegistry = require('../../services/enterpriseIdpClientRegistry');
const authStore = require('../../services/enterpriseIdpAuthStore');
// Required at module scope — this repo's global setup.js afterEach calls
// jest.resetModules(), so a lazy require() inside a test would rebind to a
// fresh module instance that doesn't share state with clientRegistry/authStore.
const enterpriseIdpRouter = require('../../routes/enterpriseIdp');

const CLIENT_ID = 'inspector-client';
const CLIENT_SECRET = 'inspector-secret';
const REDIRECT_URI = 'http://127.0.0.1:6274/oauth/callback';
const ISSUER = 'https://api.ping.demo:3001';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/enterprise-idp', enterpriseIdpRouter);
  return a;
}

/** A JWT-shaped (but unsigned) token — enough for getJwtClaim's decode-only read. */
function fakeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.`;
}

describe('enterprise IdP /authorize (EMA leg 1, PingOne federation)', () => {
  const ORIG = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    clientRegistry.resetForTests();
    authStore.resetForTests();
    clientRegistry.registerClient({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uris: [REDIRECT_URI] });
    configStore.getEffective.mockImplementation((k) => (k === 'enterprise_idp_issuer' ? ISSUER : ''));
    process.env.ENTERPRISE_IDP_PINGONE_CLIENT_ID = 'pingone-client-id';
    process.env.ENTERPRISE_IDP_PINGONE_CLIENT_SECRET = 'pingone-client-secret';
    process.env.PINGONE_AUTHORIZATION_ENDPOINT = 'https://auth.pingone.com/env-id/as/authorize';
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env-id/as/token';
  });
  afterEach(() => { process.env = { ...ORIG }; });

  function validQuery(overrides) {
    return {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      code_challenge: 'client-challenge',
      code_challenge_method: 'S256',
      state: 'inspector-state-123',
      ...overrides,
    };
  }

  test('400 invalid_request when client_id is missing', async () => {
    const { client_id, ...q } = validQuery();
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(q);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('400 invalid_client for an unregistered client_id', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(validQuery({ client_id: 'never-registered' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  test('400 invalid_request when redirect_uri is not registered for that client', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(validQuery({ redirect_uri: 'https://evil.example/cb' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('400 invalid_request when code_challenge (PKCE) is missing', async () => {
    const { code_challenge, ...q } = validQuery();
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(q);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('503 when PingOne federation env vars are not configured', async () => {
    delete process.env.ENTERPRISE_IDP_PINGONE_CLIENT_ID;
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(validQuery());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('temporarily_unavailable');
  });

  test('redirects to PingOne with our own PKCE and a relay state binding the original request', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize').query(validQuery());
    expect(res.status).toBe(302);

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env-id/as/authorize');
    expect(location.searchParams.get('client_id')).toBe('pingone-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ISSUER}/api/enterprise-idp/authorize/callback`);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBe('openid profile email');

    const relayState = location.searchParams.get('state');
    const pending = authStore.consumePendingAuthorization(relayState);
    expect(pending).toMatchObject({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, clientState: 'inspector-state-123' });
  });
});

describe('enterprise IdP /authorize/callback (PingOne -> our own code)', () => {
  const ORIG = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    clientRegistry.resetForTests();
    authStore.resetForTests();
    clientRegistry.registerClient({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uris: [REDIRECT_URI] });
    configStore.getEffective.mockImplementation((k) => (k === 'enterprise_idp_issuer' ? ISSUER : ''));
    process.env.ENTERPRISE_IDP_PINGONE_CLIENT_ID = 'pingone-client-id';
    process.env.ENTERPRISE_IDP_PINGONE_CLIENT_SECRET = 'pingone-client-secret';
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env-id/as/token';
  });
  afterEach(() => { process.env = { ...ORIG }; });

  function pendingState(overrides) {
    return authStore.createPendingAuthorization({
      clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: 'openid', codeChallenge: 'client-challenge',
      codeChallengeMethod: 'S256', clientState: 'inspector-state-123', pingOneCodeVerifier: 'our-own-verifier',
      ...overrides,
    });
  }

  test('400 access_denied when PingOne reports an error', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('access_denied');
  });

  test('400 invalid_request when code or state is missing', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize/callback').query({ code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('400 invalid_grant for an unknown or expired state', async () => {
    const res = await request(app()).get('/api/enterprise-idp/authorize/callback').query({ code: 'abc', state: 'never-issued' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('redirects to the original client with our own code and its own state', async () => {
    const state = pendingState();
    axios.post.mockResolvedValue({ data: { access_token: fakeJwt({ sub: 'pingone-user-1', email: 'demo@example.com' }) } });

    const res = await request(app()).get('/api/enterprise-idp/authorize/callback').query({ code: 'pingone-code', state });
    expect(res.status).toBe(302);

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('inspector-state-123');

    const ownCode = location.searchParams.get('code');
    const entry = authStore.consumeCode(ownCode);
    expect(entry).toMatchObject({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, subject: 'pingone-user-1', email: 'demo@example.com' });
  });

  test('posts the PingOne token exchange with our own PKCE verifier and the callback redirect_uri', async () => {
    const state = pendingState({ pingOneCodeVerifier: 'the-verifier' });
    axios.post.mockResolvedValue({ data: { access_token: fakeJwt({ sub: 'u1' }) } });

    await request(app()).get('/api/enterprise-idp/authorize/callback').query({ code: 'pingone-code', state });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://auth.pingone.com/env-id/as/token');
    const parsed = new URLSearchParams(body);
    expect(parsed.get('grant_type')).toBe('authorization_code');
    expect(parsed.get('code')).toBe('pingone-code');
    expect(parsed.get('redirect_uri')).toBe(`${ISSUER}/api/enterprise-idp/authorize/callback`);
    expect(parsed.get('code_verifier')).toBe('the-verifier');
  });
});
