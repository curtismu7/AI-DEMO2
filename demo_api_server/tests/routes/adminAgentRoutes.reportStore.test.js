'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/agentSessionMiddleware', () => ({
  agentSessionMiddleware: (req, res, next) => {
    const h = req.headers['x-test-agent-context'];
    req.agentContext = h ? JSON.parse(h) : {};
    next();
  },
}));
jest.mock('../../services/requestEventEmitter', () => ({
  requestEventEmitterMiddleware: (req, res, next) => next(),
}));
jest.mock('../../services/pingOneAdminAccessService', () => ({
  checkAccess: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/adminAgentService', () => ({
  processAdminMessage: jest.fn(async () => ({
    reply: 'Here are the users.',
    success: true,
    toolsCalled: ['listUsers'],
    tokenEvents: [{ id: 'user-token', status: 'success' }],
  })),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({ saveMessage: jest.fn() }));
jest.mock('../../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));

const adminAgentRoutes = require('../../routes/adminAgentRoutes');
const { processAdminMessage } = require('../../services/adminAgentService');
const reportStore = require('../../services/lmdb/reportStore.lmdb');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { id: 'sess-1', user: { username: 'admin1' } };
    next();
  });
  app.use('/api/admin-agent', adminAgentRoutes);
  return app;
}

describe('POST /api/admin-agent/message archives to reportStore', () => {
  beforeEach(() => {
    reportStore.saveRun.mockClear();
  });

  it('archives a successful run with vertical pingone-admin', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/admin-agent/message')
      .set('x-test-agent-context', JSON.stringify({ userId: 'admin-1', accessToken: 'tok' }))
      .send({ message: 'list users starting with curt' })
      .expect(200);

    expect(reportStore.saveRun).toHaveBeenCalledTimes(1);
    const record = reportStore.saveRun.mock.calls[0][0];
    expect(record.userId).toBe('admin-1');
    expect(record.vertical).toBe('pingone-admin');
    expect(record.prompt).toBe('list users starting with curt');
    expect(record.agentPath).toBe('admin-agent');
    expect(record.toolsCalled).toEqual(['listUsers']);
    expect(record.tokenEvents).toEqual([{ id: 'user-token', status: 'success' }]);
    expect(record.success).toBe(true);
  });

  it('records success:false when processAdminMessage reports failure', async () => {
    processAdminMessage.mockResolvedValueOnce({
      reply: '', success: false, error: 'boom', toolsCalled: [], tokenEvents: [],
    });
    const app = buildApp();
    await request(app)
      .post('/api/admin-agent/message')
      .set('x-test-agent-context', JSON.stringify({ userId: 'admin-1', accessToken: 'tok' }))
      .send({ message: 'do something' })
      .expect(502);

    expect(reportStore.saveRun).toHaveBeenCalledTimes(1);
    expect(reportStore.saveRun.mock.calls[0][0].success).toBe(false);
  });

  it('does not archive when the session is unauthenticated', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/admin-agent/message')
      .send({ message: 'list users' })
      .expect(401);

    expect(reportStore.saveRun).not.toHaveBeenCalled();
  });

  it('a reportStore failure does not break the response', async () => {
    reportStore.saveRun.mockImplementationOnce(() => { throw new Error('lmdb down'); });
    const app = buildApp();
    const res = await request(app)
      .post('/api/admin-agent/message')
      .set('x-test-agent-context', JSON.stringify({ userId: 'admin-1', accessToken: 'tok' }))
      .send({ message: 'list users' })
      .expect(200);

    expect(res.body.reply).toBe('Here are the users.');
  });
});
