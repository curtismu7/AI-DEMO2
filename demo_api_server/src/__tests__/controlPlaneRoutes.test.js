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

// Build a fresh app + return the fresh service mocks, all on the same module
// instance, bound to a single shared session object for the test.
function build(session) {
  const auditLogService = require('../../services/auditLogService');
  const appEventService = require('../../services/appEventService');
  const agentLifecycleEvents = require('../../services/agentLifecycleEvents');
  const controlPlaneRouter = require('../../routes/controlPlane');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; req.session.save = (cb) => cb && cb(); next(); });
  app.use('/api/control-plane', controlPlaneRouter);
  return { app, auditLogService, appEventService, agentLifecycleEvents };
}

describe('control-plane routes', () => {
  it('GET /agents returns live + 5 demo', async () => {
    const { app } = build({});
    const res = await request(app).get('/api/control-plane/agents');
    expect(res.status).toBe(200);
    expect(res.body.live.kind).toBe('live');
    expect(res.body.demo).toHaveLength(5);
  });

  it('POST stop on a demo agent writes audit, emits event, flips status', async () => {
    const session = {};
    const { app, auditLogService, appEventService, agentLifecycleEvents } = build(session);
    const res = await request(app).post('/api/control-plane/agents/glean/stop').send({ reason: 'manual_safety' });
    expect(res.status).toBe(200);
    expect(res.body.audit_id).toBe('audit-123');
    expect(auditLogService.recordKillEvent).toHaveBeenCalledWith('glean', 'manual_safety', expect.any(Object), 0, 'demo-glean');
    expect(appEventService.logEvent).toHaveBeenCalledWith(
      'control_plane', 'warning', expect.stringContaining('Glean'), expect.objectContaining({ tag: 'agent_stopped' })
    );
    expect(agentLifecycleEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'leaver', agentId: 'glean', kind: 'demo', auditId: 'audit-123' })
    );
    const after = await request(app).get('/api/control-plane/agents');
    expect(after.body.demo.find((a) => a.id === 'glean').status).toBe('revoked');
  });

  it('POST stop on the live id is rejected with 409', async () => {
    const { app } = build({});
    const res = await request(app).post('/api/control-plane/agents/demo-agent/stop').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('use_live_endpoint');
  });

  it('POST stop on unknown id is 404', async () => {
    const { app } = build({});
    const res = await request(app).post('/api/control-plane/agents/nope/stop').send({});
    expect(res.status).toBe(404);
  });

  it('POST stop-all flips all active demo agents', async () => {
    const session = {};
    const { app } = build(session);
    const res = await request(app).post('/api/control-plane/stop-all').send({ reason: 'manual_safety' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    const after = await request(app).get('/api/control-plane/agents');
    expect(after.body.demo.every((a) => a.status === 'revoked')).toBe(true);
  });

  it('POST reset restores all to active', async () => {
    const session = {};
    const { app } = build(session);
    await request(app).post('/api/control-plane/stop-all').send({});
    const res = await request(app).post('/api/control-plane/reset').send({});
    expect(res.status).toBe(200);
    expect(res.body.demo.every((a) => a.status === 'active')).toBe(true);
  });

  it('POST reset emits a joiner event per re-seeded demo agent', async () => {
    const session = {};
    const { app, agentLifecycleEvents } = build(session);
    agentLifecycleEvents.emit.mockClear();
    const res = await request(app).post('/api/control-plane/reset').send({});
    expect(res.status).toBe(200);
    expect(agentLifecycleEvents.emit).toHaveBeenCalledTimes(5);
    expect(agentLifecycleEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'joiner', kind: 'demo', reason: 'registration' })
    );
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
