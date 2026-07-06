'use strict';

/**
 * Phase 2 — hitlGateway.regression.test.js
 *
 * Mocked-dependency suite covering Phase 2 CR-02 + CR-03 on the BFF side,
 * now backed by the canonical :3009 store via hitlServiceClient (mocked).
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

jest.setTimeout(15000);

const TEST_CONFIG = {
  ff_hitl_enabled: 'true',
  confirm_threshold_usd: '500',
  mfa_threshold_usd: '500',
};

const mockChallengeStore = new Map();

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => TEST_CONFIG[key] || null),
  get: jest.fn((key) => TEST_CONFIG[key] || null),
  setRaw: jest.fn(),
}));

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
      id: 'test-session-id',
      user: { id: 'test-user-1', oauthId: 'test-user-1' },
      save: (cb) => cb && cb(),
    };
    req.agentContext = {
      userId: 'test-user-1',
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

function buildApp({ sessionId = 'test-session-fixed' } = {}) {
  jest.resetModules();
  mockChallengeStore.clear();

  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.session = {
      id: sessionId,
      user: { id: 'test-user-1', oauthId: 'test-user-1' },
      save: (cb) => cb && cb(),
    };
    next();
  });

  const router = require('../../routes/demoAgentRoutes');
  app.use('/api/demo-agent', router);
  return app;
}

describe('hitlGateway regression — canonical store + CR-03 secure consentId', () => {
  beforeEach(() => {
    mockChallengeStore.clear();
    jest.clearAllMocks();
  });

  test('POST /message returns 428 with a consentId stored in the canonical HITL store', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000 to checking' });

    expect(res.status).toBe(428);
    expect(res.body.requiresConsent).toBe(true);
    expect(mockChallengeStore.has(res.body.consentId)).toBe(true);
    expect(mockChallengeStore.get(res.body.consentId).tool).toBe('create_transfer');
  });

  test('generated consentId is a 36-char hex UUID (CR-03)', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });

    expect(res.status).toBe(428);
    expect(res.body.consentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test('POST /consent with approved=true marks challenge approved in canonical store', async () => {
    const app = buildApp();

    const init = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const consentId = init.body.consentId;

    const resp = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId, approved: true });

    expect(resp.status).toBe(200);
    expect(mockChallengeStore.get(consentId).status).toBe('approved');
  });

  test('POST /consent with approved=false marks challenge denied in canonical store', async () => {
    const app = buildApp();

    const init = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const consentId = init.body.consentId;

    const resp = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId, approved: false });

    expect(resp.status).toBe(200);
    expect(mockChallengeStore.get(consentId).status).toBe('denied');
  });

  test('POST /consent with non-UUID consentId returns 400', async () => {
    const app = buildApp();

    const resp = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: 'not-a-real-id-deadbeef', approved: true });

    expect(resp.status).toBe(400);
  });

  test('POST /consent with valid UUID but unknown consentId returns 404', async () => {
    const app = buildApp();

    const fakeId = '00000000-0000-4000-8000-000000000001';
    const resp = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: fakeId, approved: true });

    expect(resp.status).toBe(404);
  });

  test('POST /consent rejects a challenge owned by another user', async () => {
    const app = buildApp();
    const init = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const consentId = init.body.consentId;
    mockChallengeStore.get(consentId).userId = 'other-user';

    const resp = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId, approved: true });

    expect(resp.status).toBe(403);
  });

  test('two consents in the same session get distinct IDs in the canonical store', async () => {
    const app = buildApp();

    const a = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $5000' });
    const b = await request(app)
      .post('/api/demo-agent/message')
      .send({ message: 'transfer $6000' });

    expect(a.body.consentId).not.toBe(b.body.consentId);
    expect(mockChallengeStore.has(a.body.consentId)).toBe(true);
    expect(mockChallengeStore.has(b.body.consentId)).toBe(true);
  });
});
