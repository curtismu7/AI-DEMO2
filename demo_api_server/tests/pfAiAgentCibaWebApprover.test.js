'use strict';

const express = require('express');
const request = require('supertest');
const approver = require('../services/pfAiAgentCibaWebApproverService');
const { getFeatureStatus, resolveCibaConfig } = require('../services/pfAiAgentFeatureConfig');
const { createPfAiAgentRouter } = require('../routes/pfAiAgent');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const SECRET = 'approver-secret-value';
const TX = '3f2b8c1e-5a4d-4e7a-9b1c-0d2e3f4a5b6c';
const bearer = { Authorization: `Bearer ${SECRET}` };

function makeStore(overrides = {}) {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_ai_ciba_enabled: 'true',
    pf_ai_ciba_client_id: 'ai-demo-pf-ciba',
    pf_ai_ciba_client_secret: 'client-secret',
    pf_ai_ciba_web_approver_enabled: 'true',
    pf_ai_ciba_approver_secret: SECRET,
    pf_ai_ciba_mock_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
    ...overrides,
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const sessionWithPending = (loginHint = 'demouser') => ({
  oauthProvider: 'pingone', oauthTokens: { accessToken: 't' }, user: { username: loginHint },
  pfAiAgent: { cibaPending: { loginHint, expiresAt: Date.now() + 60000 } },
});

function appWith(session, store = makeStore()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store, fetchImpl: jest.fn(), dataStore: {} }));
  return app;
}

describe('CIBA web approver', () => {
  beforeEach(() => approver._requests.clear());

  test('the plugin registers, polls, and the page decides', async () => {
    const app = appWith(sessionWithPending());
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').set(bearer)
      .send({ transactionId: TX, subject: 'demouser', bindingMessage: 'Approve-125' }).expect(200);
    expect((await request(app).get(`/api/pf-ai-agent/ciba/web-approver/requests/${TX}`).set(bearer).expect(200)).body)
      .toEqual({ status: 'pending' });

    await request(app).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'approve' }).expect(200);
    expect((await request(app).get(`/api/pf-ai-agent/ciba/web-approver/requests/${TX}`).set(bearer)).body)
      .toEqual({ status: 'approved' });
  });

  test('deny is recorded', async () => {
    const app = appWith(sessionWithPending());
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').set(bearer)
      .send({ transactionId: TX, subject: 'DemoUser' }).expect(200);
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'deny' }).expect(200);
    expect((await request(app).get(`/api/pf-ai-agent/ciba/web-approver/requests/${TX}`).set(bearer)).body)
      .toEqual({ status: 'denied' });
  });

  test('the plugin endpoints reject a missing or wrong credential like a feature that is off', async () => {
    const app = appWith(sessionWithPending());
    const body = { transactionId: TX, subject: 'demouser' };
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').send(body).expect(404);
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').set('Authorization', 'Bearer nope').send(body).expect(404);
    await request(app).get(`/api/pf-ai-agent/ciba/web-approver/requests/${TX}`).set('Authorization', 'Bearer nope').expect(404);
  });

  test('everything is inert when the flag is off, even with the right credential', async () => {
    const app = appWith(sessionWithPending(), makeStore({ pf_ai_ciba_web_approver_enabled: 'false' }));
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').set(bearer)
      .send({ transactionId: TX, subject: 'demouser' }).expect(404);
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'approve' }).expect(404);
  });

  test('everything is inert in production', async () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await request(appWith(sessionWithPending())).post('/api/pf-ai-agent/ciba/web-approver/requests').set(bearer)
        .send({ transactionId: TX, subject: 'demouser' }).expect(404);
    } finally {
      process.env.NODE_ENV = was;
    }
  });

  test('a bad registration, an unknown id, and a decision with nothing to decide are refused', async () => {
    const app = appWith(sessionWithPending());
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/requests').set(bearer).send({ transactionId: 'x', subject: 'demouser' }).expect(400);
    await request(app).get(`/api/pf-ai-agent/ciba/web-approver/requests/${TX}`).set(bearer).expect(404);
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'approve' }).expect(409);
    await request(app).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'maybe' }).expect(400);
  });

  test('a request expires after five minutes', () => {
    let clock = 1000;
    const now = () => clock;
    approver.register({ headers: { authorization: `Bearer ${SECRET}` }, body: { transactionId: TX, subject: 'demouser' }, store: makeStore(), now });
    clock += 5 * 60 * 1000 + 1;
    expect(() => approver.lookup({ headers: { authorization: `Bearer ${SECRET}` }, transactionId: TX, store: makeStore(), now })).toThrow(/Not found/);
  });

  test('the page decision needs an application session', async () => {
    await request(appWith({})).post('/api/pf-ai-agent/ciba/web-approver/decision').send({ decision: 'approve' }).expect(401);
  });

  test('status: the web approver takes over from the mock and uses its own client', () => {
    expect(getFeatureStatus(makeStore())).toMatchObject({ ciba: true, cibaWebApprover: true, cibaMock: false });
    expect(getFeatureStatus(makeStore({ pf_ai_ciba_web_approver_enabled: 'false' })))
      .toMatchObject({ cibaWebApprover: false, cibaMock: true });
    expect(resolveCibaConfig(makeStore()).clientId).toBe('ai-demo-pf-ciba-web');
    expect(resolveCibaConfig(makeStore({ pf_ai_ciba_web_approver_enabled: 'false' })).clientId).toBe('ai-demo-pf-ciba');
  });

  test('without the shared secret the web approver is not on', () => {
    expect(getFeatureStatus(makeStore({ pf_ai_ciba_approver_secret: '' })).cibaWebApprover).toBe(false);
  });
});
