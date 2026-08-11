const request = require('supertest');
const express = require('express');

jest.mock('../services/agentRunRegistry', () => ({
  listActiveRuns: jest.fn(),
}));
// Bypass real token/session validation — see adminKillSwitchRoute.derivedKey.test.js,
// the sibling test for this same authenticateToken-gated router.
jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
}));
const agentRunRegistry = require('../services/agentRunRegistry');
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    req.sessionID = 'sess-fixed';
    req.session = { user: { id: 'u1' } };
    next();
  });
  app.use('/api/admin', adminRouter);
  return app;
}

describe('GET /agent/:agentId/active-runs', () => {
  test('returns runs for the derived key, without userId', async () => {
    agentRunRegistry.listActiveRuns.mockReturnValueOnce([
      { runId: 'r1', tool: 'reorder', userId: 'u1', startedAt: 1000 },
    ]);
    const res = await request(buildApp()).get('/api/admin/agent/default-agent/active-runs');
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([{ runId: 'r1', tool: 'reorder', startedAt: 1000 }]);
  });
});
