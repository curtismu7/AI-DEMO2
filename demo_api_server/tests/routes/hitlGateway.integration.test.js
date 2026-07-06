'use strict';

/**
 * Phase 2 — hitlGateway.integration.test.js
 *
 * Integration counterpart using real configStore + mocked canonical HITL client.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

jest.setTimeout(15000);

const mockChallengeStore = new Map();

jest.mock('../../services/hitlServiceClient', () => {
  const { randomUUID } = require('crypto');
  return {
  createChallenge: jest.fn(async (payload) => {
    const challengeId = randomUUID();
    mockChallengeStore.set(challengeId, {
      challengeId,
      status: 'pending',
      tool: payload.tool,
      userId: payload.userId,
      context: payload.context || {},
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    return { challengeId, status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' };
  }),
  getChallengeStatus: jest.fn(async (id) => {
    const entry = mockChallengeStore.get(id);
    if (!entry) {
      const err = new Error('not found');
      err.status = 404;
      throw err;
    }
    return { ...entry };
  }),
  respondToChallenge: jest.fn(async (id, decision) => {
    const entry = mockChallengeStore.get(id);
    if (!entry) throw new Error('not found');
    entry.status = decision;
    entry.decision = decision;
    return { challengeId: id, status: decision, decision };
  }),
  verifyHitlReceipt: jest.requireActual('../../services/hitlServiceClient').verifyHitlReceipt,
  };
});

jest.mock('../../middleware/agentSessionMiddleware', () => ({
  agentSessionMiddleware: (req, res, next) => {
    req.session = req.session || {
      id: 'integration-session-id',
      user: { id: 'integration-user-1', oauthId: 'integration-user-1' },
      save: (cb) => cb && cb(),
    };
    req.agentContext = {
      userId: 'integration-user-1',
      accessToken: 'fake-bearer-token',
      tokenEvents: [],
    };
    next();
  },
}));

jest.mock('../../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(() =>
    Promise.resolve({
      requiresConsent: true,
      action: 'create_transfer',
      amount: 5000,
      details: { fromAccountId: 'acct-1', toAccountId: 'acct-2' },
      message: 'High-value transfer requires approval',
      tokenEvents: [],
    }),
  ),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn(() => Promise.resolve()),
}));

function buildApp() {
  jest.resetModules();
  mockChallengeStore.clear();

  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.session = {
      id: 'integ-fixed-session-id',
      user: { id: 'integration-user-1', oauthId: 'integration-user-1' },
      save: (cb) => cb && cb(),
    };
    next();
  });

  const router = require('../../routes/demoAgentRoutes');
  app.use('/api/demo-agent', router);
  return app;
}

describe('hitlGateway integration — real configStore + canonical HITL store', () => {
  beforeEach(() => {
    mockChallengeStore.clear();
    jest.clearAllMocks();
  });

  test('428 response carries a UUID consentId indexed in the canonical store', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });

    expect(res.status).toBe(428);
    expect(res.body.consentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mockChallengeStore.has(res.body.consentId)).toBe(true);
  });

  test('approve then reject flow records both decisions under their own consentIds', async () => {
    const app = buildApp();

    const a = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const b = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $6000' });

    await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: a.body.consentId, approved: true });
    await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: b.body.consentId, approved: false });

    expect(mockChallengeStore.get(a.body.consentId).status).toBe('approved');
    expect(mockChallengeStore.get(b.body.consentId).status).toBe('denied');
  });

  test('consent with unknown consentId returns 404', async () => {
    const app = buildApp();

    const init = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const realId = init.body.consentId;

    const fakeId = '00000000-0000-4000-8000-000000000000';
    const wrong = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: fakeId, approved: true });

    expect(wrong.status).toBe(404);
    expect(mockChallengeStore.get(realId).status).toBe('pending');
  });

  test('cross-user consent attempt returns 403', async () => {
    const app = buildApp();
    const init = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const consentId = init.body.consentId;
    mockChallengeStore.get(consentId).userId = 'other-user';

    const cross = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId, approved: true });

    expect(cross.status).toBe(403);
    expect(mockChallengeStore.get(consentId).status).toBe('pending');
  });
});
