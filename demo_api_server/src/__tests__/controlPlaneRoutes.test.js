'use strict';
const express = require('express');
const request = require('supertest');

// setup.js runs jest.resetModules() between tests, so require the router + mocked
// services INSIDE each test (via build()) to keep them on one module instance.
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { role: 'enduser' }; next(); },
}));
jest.mock('../../services/auditLogService', () => ({
  recordKillEvent: jest.fn(async () => 'audit-123'),
  recordKillFailure: jest.fn(async () => 'audit-fail'),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn(() => ({ id: 'evt' })) }));
jest.mock('../../services/agentLifecycleEvents', () => ({
  emit: jest.fn(() => ({ eventId: 'ale-1' })),
  query: jest.fn(() => []),
  summary: jest.fn(() => ({ totalEvents: 0, byEventType: {} })),
}));
jest.mock('../../services/controlPlane/liveAgentInfo', () => ({
  getLiveAgentRow: () => ({ id: 'demo-agent', kind: 'live', label: 'Live Agent (Super Banking)', provider: 'helix', status: 'active' }),
}));
jest.mock('../../services/pingOneSessionService', () => ({
  getUserSessions: jest.fn(async () => []),
  terminateUserSessions: jest.fn(async () => ({ terminated: 0, errors: [] })),
  terminateAllUserSessions: jest.fn(async (userId) => ({ sessions_found: userId ? 2 : 0, terminated: userId ? 2 : 0, errors: [] })),
}));
jest.mock('../../services/killSwitchService', () => ({
  killAgent: jest.fn(async () => ({
    success: true,
    revoked_at: new Date().toISOString(),
    time_to_revoke_ms: 120,
    scope: 'full',
    steps: [],
    auto_reset_at: new Date(Date.now() + 600000).toISOString(),
  })),
  isAgentRevoked: jest.fn(async () => false),
}));

// Build a fresh app + return the fresh service mocks, all on the same module
// instance, bound to a single shared session object for the test.
function build(session) {
  const auditLogService = require('../../services/auditLogService');
  const appEventService = require('../../services/appEventService');
  const agentLifecycleEvents = require('../../services/agentLifecycleEvents');
  const killSwitchService = require('../../services/killSwitchService');
  const pingOneSessionService = require('../../services/pingOneSessionService');
  const controlPlaneRouter = require('../../routes/controlPlane');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; req.session.save = (cb) => cb && cb(); next(); });
  app.use('/api/control-plane', controlPlaneRouter);
  return { app, auditLogService, appEventService, agentLifecycleEvents, killSwitchService, pingOneSessionService };
}

describe('control-plane routes', () => {
  it('GET /agents returns only the live row (no simulated identities)', async () => {
    const { app } = build({});
    const res = await request(app).get('/api/control-plane/agents');
    expect(res.status).toBe(200);
    expect(res.body.live.kind).toBe('live');
    expect(res.body.demo).toHaveLength(0);
  });

  it('POST stop on an unknown id is 404 (roster is empty — nothing simulated)', async () => {
    const { app } = build({});
    const res = await request(app).post('/api/control-plane/agents/glean/stop').send({ reason: 'manual_safety' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_agent');
  });

  it('POST stop-all flips zero demo agents (nothing simulated exists)', async () => {
    const session = {};
    const { app } = build(session);
    const res = await request(app).post('/api/control-plane/stop-all').send({ reason: 'manual_safety' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('POST reset restores the (empty) roster to active', async () => {
    const session = {};
    const { app } = build(session);
    const res = await request(app).post('/api/control-plane/reset').send({});
    expect(res.status).toBe(200);
    expect(res.body.demo).toHaveLength(0);
  });

  it('POST stop on the live id is rejected with 409', async () => {
    const { app } = build({});
    const res = await request(app).post('/api/control-plane/agents/demo-agent/stop').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('use_live_endpoint');
  });

  it('POST comprehensive-shutdown runs full kill + SSO termination, then 401s', async () => {
    const session = { user: { id: 'u-1', oauthId: 'po-1' }, oauthTokens: { accessToken: 'at' }, destroy: (cb) => cb && cb() };
    const { app, killSwitchService, pingOneSessionService } = build(session);
    const res = await request(app).post('/api/control-plane/comprehensive-shutdown').send({ reason: 'comprehensive_shutdown' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('agent_killed');
    expect(killSwitchService.killAgent.mock.calls[0].slice(0, 5)).toEqual(['demo-agent', 'comprehensive_shutdown', 'po-1', { accessToken: 'at' }, 'full']);
    expect(pingOneSessionService.terminateAllUserSessions).toHaveBeenCalledWith('po-1');
    expect(res.body.stopped).toHaveLength(0);
    expect(res.body.steps.map((s) => s.key)).toEqual(['live_kill', 'pingone_sessions']);
  });

  it('POST comprehensive-shutdown survives a failing kill and still reports SSO termination', async () => {
    const session = { user: { id: 'u-1' }, destroy: (cb) => cb && cb() };
    const { app, killSwitchService } = build(session);
    killSwitchService.killAgent.mockRejectedValueOnce(new Error('pingone down'));
    const res = await request(app).post('/api/control-plane/comprehensive-shutdown').send({});
    expect(res.status).toBe(401);
    expect(res.body.steps.find((s) => s.key === 'live_kill').detail).toContain('pingone down');
    expect(res.body.steps.find((s) => s.key === 'pingone_sessions').ran).toBe(true);
  });

  describe('GET /lifecycle-events', () => {
    it('passes limit/eventType/agentId through to the query filters', async () => {
      const { app, agentLifecycleEvents } = build({});
      await request(app).get('/api/control-plane/lifecycle-events?eventType=leaver&agentId=glean&limit=10');
      expect(agentLifecycleEvents.query).toHaveBeenCalledWith({ eventType: 'leaver', agentId: 'glean', limit: 10 });
    });

    it('returns events + summary with no filters', async () => {
      const { app } = build({});
      const res = await request(app).get('/api/control-plane/lifecycle-events');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('events');
      expect(res.body).toHaveProperty('summary');
    });
  });
});
