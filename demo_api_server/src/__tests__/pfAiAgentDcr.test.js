'use strict';

const express = require('express');
const request = require('supertest');

const mockConfig = {
  issuer: 'https://pf.example.test',
  tokenEndpoint: 'https://pf.example.test/as/token.oauth2',
  registrationEndpoint: 'https://pf.example.test/as/clients.oauth2',
  iatClientId: 'iat-client',
  iatClientSecret: 'iat-secret-value',
};
jest.mock('../../services/pfAiAgentFeatureConfig', () => ({
  ...jest.requireActual('../../services/pfAiAgentFeatureConfig'),
  resolveDcrConfig: jest.fn(() => mockConfig),
}));

const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

const jwt = (claims) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const IAT = jwt({ scope: 'dcr:register', client_id: 'iat-client' });
const CLIENT_TOKEN = jwt({ scope: 'accounts:read', client_id: 'dc-abc' });

// A PingFederate stand-in with the behaviour the demo teaches: registration needs the
// initial access token, the client may only have accounts:read, a deleted client is gone.
function fakePf({ openRegistration = false } = {}) {
  let registered = null;
  const json = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
  const fetchImpl = jest.fn(async (url, init) => {
    const auth = init.headers?.Authorization || '';
    if (url === mockConfig.tokenEndpoint) {
      const params = new URLSearchParams(init.body);
      const [id, secret] = Buffer.from(auth.replace('Basic ', ''), 'base64').toString().split(':');
      if (id === 'iat-client' && secret === 'iat-secret-value') return json(200, { access_token: IAT, token_type: 'Bearer' });
      if (registered && id === registered.client_id && secret === registered.client_secret) {
        return params.get('scope') === 'accounts:read'
          ? json(200, { access_token: CLIENT_TOKEN, token_type: 'Bearer' })
          : json(400, { error: 'invalid_scope' });
      }
      return json(401, { error: 'invalid_client' });
    }
    if (url === mockConfig.registrationEndpoint && init.method === 'POST') {
      if (!openRegistration && auth !== `Bearer ${IAT}`) return json(401, { error: 'invalid_access_token' });
      registered = { client_id: 'dc-abc', client_secret: 'new-client-secret-value', registration_access_token: 'rat-value' };
      return json(201, { ...registered, registration_client_uri: 'https://elsewhere.example.test/as/clients.oauth2/dc-abc' });
    }
    if (url === `${mockConfig.registrationEndpoint}/dc-abc` && init.method === 'DELETE') {
      if (auth !== 'Bearer rat-value') return json(401, { error: 'invalid_token' });
      registered = null;
      return { status: 204, ok: true, text: async () => '' };
    }
    return json(404, { error: 'not_found' });
  });
  return fetchImpl;
}

function appWith(session, fetchImpl) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: { getEffective: () => '' }, fetchImpl }));
  return app;
}
const signedIn = () => ({ oauthProvider: 'pingfederate', oauthTokens: { accessToken: 'session-token' } });

describe('PF AI Agent dynamic client registration', () => {
  test('runs register, use and delete, with every refusal shown and no secret in any reply', async () => {
    const session = signedIn();
    const app = appWith(session, fakePf());

    const iat = await request(app).post('/api/pf-ai-agent/dcr/initial-token').expect(200);
    expect(iat.body.claims.scope).toBe('dcr:register');

    const reg = await request(app).post('/api/pf-ai-agent/dcr/register').expect(200);
    expect(reg.body).toMatchObject({ clientId: 'dc-abc', anonymousRefused: true });

    const use = await request(app).post('/api/pf-ai-agent/dcr/token').expect(200);
    expect(use.body).toMatchObject({ claims: { scope: 'accounts:read' }, forbiddenRefused: true });

    const del = await request(app).post('/api/pf-ai-agent/dcr/delete').expect(200);
    expect(del.body.deletedRefused).toBe(true);
    expect(del.body.trace.map((s) => s.id)).toEqual([
      'initial-access-token', 'register-anonymous', 'register', 'client-token', 'client-token-forbidden', 'delete', 'deleted-token',
    ]);
    expect(session.pfAiAgent.dcr).toBeUndefined();

    const replies = JSON.stringify([iat.body, reg.body, use.body, del.body]);
    for (const secret of ['iat-secret-value', 'new-client-secret-value', 'rat-value', IAT, CLIENT_TOKEN]) {
      expect(replies).not.toContain(secret);
    }
  });

  test('deletes at the configured endpoint, never at the URI PingFederate returned', async () => {
    const fetchImpl = fakePf();
    const app = appWith(signedIn(), fetchImpl);
    for (const path of ['initial-token', 'register', 'token', 'delete']) {
      await request(app).post(`/api/pf-ai-agent/dcr/${path}`).expect(200);
    }
    expect(fetchImpl.mock.calls.map(([url]) => url).some((url) => url.includes('elsewhere.example.test'))).toBe(false);
  });

  test('says so when PingFederate accepts an anonymous registration', async () => {
    const app = appWith(signedIn(), fakePf({ openRegistration: true }));
    await request(app).post('/api/pf-ai-agent/dcr/initial-token').expect(200);
    const reg = await request(app).post('/api/pf-ai-agent/dcr/register').expect(200);
    expect(reg.body.anonymousRefused).toBe(false);
    expect(reg.body.trace.find((s) => s.id === 'register-anonymous').note).toMatch(/open registration/);
  });

  test('refuses a step out of order', async () => {
    const res = await request(appWith(signedIn(), fakePf())).post('/api/pf-ai-agent/dcr/register').expect(409);
    expect(res.body.error).toBe('PF_AI_DCR_STEP_ORDER');
  });

  test('needs an application session', async () => {
    await request(appWith({}, fakePf())).post('/api/pf-ai-agent/dcr/initial-token').expect(401);
  });
});
