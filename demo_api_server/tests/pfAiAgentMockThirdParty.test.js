'use strict';

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { redeemIdJag } = require('../services/pfAiAgentMockThirdPartyService');
const { createPfAiAgentRouter } = require('../routes/pfAiAgent');

const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pf-signing-key', use: 'sig', alg: 'RS256' };

const CLIENT = { id: 'third-party-client', secret: 'third-party-secret' };

function makeStore(overrides = {}) {
  const values = {
    pf_ai_third_party_mock_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_ai_cross_domain_client_id: 'pf-exchange-client',
    pf_ai_cross_domain_client_secret: 'pf-exchange-secret',
    pf_ai_cross_domain_audience: 'https://third-party.example.test/as',
    pf_ai_cross_domain_resource: 'https://third-party.example.test/api',
    pf_ai_cross_domain_scope: 'tp:read',
    pf_ai_third_party_token_endpoint: 'https://third-party.example.test/token',
    pf_ai_third_party_client_id: CLIENT.id,
    pf_ai_third_party_client_secret: CLIENT.secret,
    pf_ai_third_party_token_endpoint_auth_method: 'basic',
    pf_ai_third_party_resource: 'https://third-party.example.test/api',
    pf_ai_third_party_scope: 'tp:read tp:write',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

function signIdJag({ claims = {}, typ = 'oauth-id-jag+jwt', key = privateKey } = {}) {
  return jwt.sign({
    iss: 'https://pf.example.test',
    aud: 'https://third-party.example.test/as',
    sub: 'demouser',
    scope: 'tp:read',
    resource: 'https://third-party.example.test/api',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  }, key, { algorithm: 'RS256', keyid: jwk.kid, header: { typ } });
}

const jwksFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) });
const basic = (id = CLIENT.id, secret = CLIENT.secret) => ({
  authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
});
const grant = (overrides = {}) => ({
  grant_type: JWT_BEARER,
  assertion: signIdJag(),
  scope: 'tp:read',
  resource: 'https://third-party.example.test/api',
  ...overrides,
});

describe('mock third-party authorization server', () => {
  test('does nothing unless it is switched on', async () => {
    const result = await redeemIdJag({
      body: grant(), headers: basic(), store: makeStore({ pf_ai_third_party_mock_enabled: 'false' }), fetchImpl: jwksFetch(),
    });
    expect(result).toBeNull();
  });

  test('redeems a valid ID-JAG for a token with the requested scope', async () => {
    const result = await redeemIdJag({ body: grant(), headers: basic(), store: makeStore(), fetchImpl: jwksFetch() });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ token_type: 'Bearer', expires_in: 300, scope: 'tp:read' });
    expect(result.body.access_token).toEqual(expect.any(String));
    expect(result.body.access_token.length).toBeGreaterThan(30);
  });

  test('accepts client_secret_post when that is how the BFF is configured', async () => {
    const store = makeStore({ pf_ai_third_party_token_endpoint_auth_method: 'post' });
    const result = await redeemIdJag({
      body: grant({ client_id: CLIENT.id, client_secret: CLIENT.secret }), headers: {}, store, fetchImpl: jwksFetch(),
    });
    expect(result.status).toBe(200);
    const basicOnly = await redeemIdJag({ body: grant(), headers: basic(), store, fetchImpl: jwksFetch() });
    expect(basicOnly).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
  });

  test.each([
    ['no credentials', {}],
    ['a wrong secret', basic(CLIENT.id, 'not-the-secret')],
    ['a wrong client id', basic('someone-else', CLIENT.secret)],
    ['a malformed header', { authorization: 'Basic !!!' }],
  ])('refuses the client with %s', async (_label, headers) => {
    const result = await redeemIdJag({ body: grant(), headers, store: makeStore(), fetchImpl: jwksFetch() });
    expect(result).toMatchObject({ status: 401, body: { error: 'invalid_client' }, challenge: true });
  });

  test('refuses another grant type, a wider scope and a different resource', async () => {
    const run = (body) => redeemIdJag({ body, headers: basic(), store: makeStore(), fetchImpl: jwksFetch() });
    expect(await run(grant({ grant_type: 'client_credentials' }))).toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } });
    expect(await run(grant({ scope: 'tp:read tp:admin' }))).toMatchObject({ status: 400, body: { error: 'invalid_scope' } });
    expect(await run(grant({ scope: '' }))).toMatchObject({ status: 400, body: { error: 'invalid_scope' } });
    expect(await run(grant({ resource: 'https://elsewhere.example.test/api' }))).toMatchObject({ status: 400, body: { error: 'invalid_target' } });
  });

  test.each([
    ['a missing assertion', { assertion: undefined }],
    ['an assertion with the wrong type header', { assertion: signIdJag({ typ: 'JWT' }) }],
    ['an assertion for another audience', { assertion: signIdJag({ claims: { aud: 'https://other.example.test/as' } }) }],
    ['an assertion from another issuer', { assertion: signIdJag({ claims: { iss: 'https://evil.example.test' } }) }],
    ['an expired assertion', { assertion: signIdJag({ claims: { exp: Math.floor(Date.now() / 1000) - 60 } }) }],
    ['an assertion signed with another key', { assertion: signIdJag({ key: otherKey }) }],
    ['an assertion for a different resource', { assertion: signIdJag({ claims: { resource: 'https://other.example.test/api' } }) }],
  ])('refuses %s as an invalid grant, without saying why', async (_label, overrides) => {
    const result = await redeemIdJag({ body: grant(overrides), headers: basic(), store: makeStore(), fetchImpl: jwksFetch() });
    expect(result).toEqual({ status: 400, body: { error: 'invalid_grant' } });
  });

  test('reports itself unavailable when the cross-domain config is incomplete', async () => {
    const result = await redeemIdJag({
      body: grant(), headers: basic(), store: makeStore({ pf_ai_cross_domain_audience: '' }), fetchImpl: jwksFetch(),
    });
    expect(result).toMatchObject({ status: 503, body: { error: 'temporarily_unavailable' } });
  });
});

describe('mock third-party token route', () => {
  const appWith = (store) => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store, fetchImpl: jwksFetch(), dataStore: {} }));
    return app;
  };
  const url = '/api/pf-ai-agent/mock-third-party/token';

  test('is not there when the mock is off', async () => {
    await request(appWith(makeStore({ pf_ai_third_party_mock_enabled: 'false' })))
      .post(url).type('form').set(basic()).send(grant()).expect(404);
  });

  test('answers a form-encoded token request with no-store headers', async () => {
    const response = await request(appWith(makeStore())).post(url).type('form').set(basic()).send(grant()).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ token_type: 'Bearer', scope: 'tp:read' });
  });

  test('challenges an unauthenticated caller', async () => {
    const response = await request(appWith(makeStore())).post(url).type('form').send(grant()).expect(401);
    expect(response.headers['www-authenticate']).toMatch(/^Basic/);
    expect(response.body).toEqual({ error: 'invalid_client' });
  });
});
