const request = require('supertest');
const express = require('express');

// Set fallback BEFORE any require of agentRunStore
process.env.AGUI_STORE_FALLBACK = 'true';

// Mock auth first
jest.mock('../middleware/auth', () => ({
  requireSession: (_req, _res, next) => next(),
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

  test('publishes consent signal for a suspended run', async () => {
    await agentRunStore.setRunState('run_test', { status: 'suspended_hitl' });
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

  test('returns 409 if run is not suspended', async () => {
    await agentRunStore.setRunState('run_active', { status: 'running' });
    const res = await request(app)
      .post('/api/agent/consent/run_active')
      .send({ approved: true });
    expect(res.status).toBe(409);
  });
});
