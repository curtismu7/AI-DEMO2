'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pf_issuer' ? 'https://pf.example:9031' : ''),
}));

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { signDelegation, signSession } = require('../services/poppySessionService');
const { createPoppyApiRouter, createAgentJwksResolver } = require('../routes/poppyApi');

const NOW = 1_800_000_000;
const HOST = 'poppy.example';
const CLIENT_ID = 'https://agent.example/client.json';
const ISSUER = 'https://pf.example:9031';
const TOKEN = 'pf-access-token';

const ecKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
};

function setup({ tokenPayload = { client_id: CLIENT_ID, scope: 'accounts:read openid' }, tokenFails = false } = {}) {
  const jwks = ecKey();
  const delegated = ecKey();
  const delegation = signDelegation({
    clientId: CLIENT_ID, jwksKid: 'k1', jwksPrivateKey: jwks.privateKey, delegatedPublicJwk: delegated.publicJwk, now: NOW,
  });
  const app = express();
  app.use('/poppy/api', createPoppyApiRouter({
    validateToken: async () => { if (tokenFails) throw new Error('bad token'); return tokenPayload; },
    resolveJwks: async () => ({ keys: [{ ...jwks.publicJwk, kid: 'k1' }] }),
    now: () => NOW,
  }));
  const session = (over = {}) => signSession({
    delegation, delegatedPrivateKey: delegated.privateKey, delegatedPublicJwk: delegated.publicJwk,
    clientId: CLIENT_ID, issuer: ISSUER, sid: 'sid-1', sub: 'user-abc', method: 'GET',
    url: `https://${HOST}/poppy/api/v1/me`, accessToken: TOKEN, now: NOW, ...over,
  });
  return { app, session };
}

const get = (app, path = '/poppy/api/v1/me') => request(app).get(path).set('Host', HOST);

describe('Poppy API', () => {
  beforeEach(() => { process.env.POPPY_DOMAIN = HOST; });
  afterEach(() => { delete process.env.POPPY_DOMAIN; });

  it('serves the OpenAPI document without a token', async () => {
    const { app } = setup();
    const res = await get(app, '/poppy/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
  });

  it('404s on any other host', async () => {
    const { app } = setup();
    const res = await request(app).get('/poppy/api/openapi.json').set('Host', 'main.example');
    expect(res.status).toBe(404);
  });

  it('returns the Poppy user for a valid token and session', async () => {
    const { app, session } = setup();
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user_id: 'user-abc', session_id: 'sid-1', scopes: ['accounts:read', 'openid'] });
  });

  it('400 invalid_session when the Poppy-Session header is missing', async () => {
    const { app } = setup();
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session');
  });

  it('a valid Session alone starts a signed-out Session: 200, no user data', async () => {
    const { app, session } = setup();
    const res = await get(app).set('Poppy-Session', session());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'signed_out', session_id: 'sid-1', agent_id: undefined, scopes: [] });
    expect(res.body.user_id).toBeUndefined();
  });

  it('a signed-out Session with a forged delegation is refused as invalid_session', async () => {
    const { app } = setup();
    const other = ecKey();
    const res = await get(app).set('Poppy-Session', signSession({
      delegation: signDelegation({ clientId: CLIENT_ID, jwksKid: 'k1', jwksPrivateKey: other.privateKey, delegatedPublicJwk: other.publicJwk, now: NOW }),
      delegatedPrivateKey: other.privateKey, delegatedPublicJwk: other.publicJwk,
      clientId: CLIENT_ID, issuer: ISSUER, sid: 'sid-x', sub: 'user-x', method: 'GET', url: `https://${HOST}/poppy/api/v1/me`, now: NOW,
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session');
  });

  it('401 invalid_token when the token does not validate', async () => {
    const { app, session } = setup({ tokenFails: true });
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  it('403 insufficient_scope when accounts:read is missing', async () => {
    const { app, session } = setup({ tokenPayload: { client_id: CLIENT_ID, scope: 'openid' } });
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'insufficient_scope', scope: 'accounts:read' });
  });

  it('400 invalid_session when the token client_id is not the session iss', async () => {
    const { app, session } = setup({ tokenPayload: { client_id: 'https://other.example/c.json', scope: 'accounts:read' } });
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(res.status).toBe(400);
    expect(res.body.error_description).toMatch(/client_id/);
  });

  it('400 invalid_session when ath does not match the token', async () => {
    const { app, session } = setup();
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session({ accessToken: 'another-token' }));
    expect(res.status).toBe(400);
    expect(res.body.error_description).toMatch(/ath/);
  });

  it('400 invalid_session when the session was signed for another URL', async () => {
    const { app, session } = setup();
    const res = await get(app).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session({ url: `https://${HOST}/poppy/api/v1/other` }));
    expect(res.status).toBe(400);
    expect(res.body.error_description).toMatch(/htu/);
  });
});

describe('createAgentJwksResolver', () => {
  const OLD = process.env.POPPY_ALLOWED_AGENTS;
  afterEach(() => { if (OLD === undefined) delete process.env.POPPY_ALLOWED_AGENTS; else process.env.POPPY_ALLOWED_AGENTS = OLD; });

  it('refuses every agent while the allow-list is empty, without fetching', async () => {
    delete process.env.POPPY_ALLOWED_AGENTS;
    const fetchJson = jest.fn();
    await expect(createAgentJwksResolver({ fetchJson })(CLIENT_ID)).rejects.toThrow(/not allowed/);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('follows client metadata to jwks_uri on the same host and caches the result', async () => {
    process.env.POPPY_ALLOWED_AGENTS = CLIENT_ID;
    const fetchJson = jest.fn(async (url) => (url === CLIENT_ID
      ? { client_id: CLIENT_ID, jwks_uri: 'https://agent.example/jwks.json' }
      : { keys: [{ kid: 'k1' }] }));
    const resolve = createAgentJwksResolver({ fetchJson });
    expect(await resolve(CLIENT_ID)).toEqual({ keys: [{ kid: 'k1' }] });
    await resolve(CLIENT_ID);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('rejects a jwks_uri on another host', async () => {
    process.env.POPPY_ALLOWED_AGENTS = CLIENT_ID;
    const fetchJson = async () => ({ client_id: CLIENT_ID, jwks_uri: 'https://evil.example/jwks.json' });
    await expect(createAgentJwksResolver({ fetchJson })(CLIENT_ID)).rejects.toThrow(/jwks_uri/);
  });

  it('rejects client metadata whose client_id does not match the URL', async () => {
    process.env.POPPY_ALLOWED_AGENTS = CLIENT_ID;
    const fetchJson = async () => ({ client_id: 'https://other.example/c.json', jwks_uri: 'https://agent.example/jwks.json' });
    await expect(createAgentJwksResolver({ fetchJson })(CLIENT_ID)).rejects.toThrow(/mismatch/);
  });
});
