const request = require('supertest');
const express = require('express');

jest.mock('../services/killSwitchService', () => ({
  isAgentRevoked: jest.fn().mockResolvedValue(false),
  killAgent: jest.fn().mockResolvedValue({
    revoked_at: '2026-08-10T00:00:00.000Z', state_snapshot_id: 'snap-1',
    time_to_revoke_ms: 5, scope: 'instance', steps: [],
  }),
}));

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
}));

const killSwitchService = require('../services/killSwitchService');
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());

  // Mock session and auth
  app.use((req, res, next) => {
    req.sessionID = 'sess-fixed';
    req.session = {
      user: { id: 'u1' },
      destroy: (cb) => cb(),
    };
    // Mock the authenticateToken middleware by setting user
    req.user = req.session.user;
    next();
  });

  app.use('/api/admin', adminRouter);
  return app;
}

describe('POST /agent/:agentId/kill-switch uses the derived session key, not the raw placeholder', () => {
  test('the "default-agent" placeholder resolves to the same key the gate would derive', async () => {
    const { deriveAgentKey } = require('../services/sessionKeyService');
    const expectedKey = deriveAgentKey({ sessionID: 'sess-fixed' }, 'default-agent');

    await request(buildApp())
      .post('/api/admin/agent/default-agent/kill-switch')
      .send({ reason: 'test', scope: 'instance' });

    expect(killSwitchService.killAgent).toHaveBeenCalledWith(
      expectedKey, 'test', 'u1', null, 'instance', 'sess-fixed',
    );
    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith(expectedKey);
  });
});
