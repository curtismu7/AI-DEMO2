const request = require('supertest');
const express = require('express');

// Set fallback BEFORE any require of agentRunStore
process.env.AGUI_STORE_FALLBACK = 'true';

const SESSION_USER = 'user-sub-1';

// Mock auth first — inject a session user sub for ownership checks
jest.mock('../middleware/auth', () => ({
  requireSession: (req, _res, next) => {
    req.session = { user: { id: SESSION_USER, oauthId: SESSION_USER } };
    next();
  },
}));

// Import and use the real store in test mode (fallback)
const { agentRunStore } = require('../services/agentRunStore');

const agentConsentRoute = require('../routes/agentConsentRoute');
const app = express();
app.use(express.json());
app.use('/api/agent', agentConsentRoute);

describe('POST /api/agent/consent/:runId', () => {
  test('returns 404 for unknown runId', async () => {
    const res = await request(app)
      .post('/api/agent/consent/run_unknown')
      .send({ approved: true });
    expect(res.status).toBe(404);
  });

  test('publishes consent signal for a suspended run owned by the session user', async () => {
    await agentRunStore.setRunState('run_test', {
      status: 'suspended_hitl',
      userId: SESSION_USER,
    });
    const received = [];
    await agentRunStore.subscribeConsent('run_test', (msg) => received.push(msg));

    const res = await request(app)
      .post('/api/agent/consent/run_test')
      .send({ approved: true });

    await new Promise((r) => setImmediate(r));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ approved: true });
  });

  test('returns 403 when run belongs to a different user', async () => {
    await agentRunStore.setRunState('run_other', {
      status: 'suspended_hitl',
      userId: 'other-user',
    });

    const res = await request(app)
      .post('/api/agent/consent/run_other')
      .send({ approved: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('returns 403 when run state has no userId binding', async () => {
    await agentRunStore.setRunState('run_unbound', { status: 'suspended_hitl' });

    const res = await request(app)
      .post('/api/agent/consent/run_unbound')
      .send({ approved: true });

    expect(res.status).toBe(403);
  });

  test('returns 409 if run is not suspended', async () => {
    await agentRunStore.setRunState('run_active', {
      status: 'running',
      userId: SESSION_USER,
    });
    const res = await request(app)
      .post('/api/agent/consent/run_active')
      .send({ approved: true });
    expect(res.status).toBe(409);
  });

  test('finding #47: returns an error response instead of hanging when the store rejects', async () => {
    const spy = jest
      .spyOn(agentRunStore, 'getRunState')
      .mockRejectedValueOnce(new Error('redis connection lost'));

    const res = await request(app)
      .post('/api/agent/consent/run_test')
      .send({ approved: true });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error).toBeTruthy();
    spy.mockRestore();
  });
});
