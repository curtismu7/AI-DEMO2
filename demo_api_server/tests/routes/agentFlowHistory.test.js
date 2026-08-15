'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/lmdb/reportStore.lmdb', () => ({
  listRuns: jest.fn(),
  getRun: jest.fn(),
}));

const agentFlowHistoryRoutes = require('../../routes/agentFlowHistory');
const reportStore = require('../../services/lmdb/reportStore.lmdb');

function buildApp(user) {
  const app = express();
  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/agent-flow-history', agentFlowHistoryRoutes);
  return app;
}

beforeEach(() => {
  reportStore.listRuns.mockReset();
  reportStore.getRun.mockReset();
});

describe('GET /api/agent-flow-history', () => {
  it('401s with no authenticated user', async () => {
    const app = buildApp(null);
    await request(app).get('/api/agent-flow-history').expect(401);
    expect(reportStore.listRuns).not.toHaveBeenCalled();
  });

  it('lists the authenticated user\'s runs scoped to their own userId', async () => {
    reportStore.listRuns.mockReturnValue([{ runId: 'run_1' }, { runId: 'run_2' }]);
    const app = buildApp({ sub: 'user-1' });
    const res = await request(app).get('/api/agent-flow-history').expect(200);

    expect(reportStore.listRuns).toHaveBeenCalledWith('user-1', { limit: 50 });
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  it('caps limit at 200', async () => {
    reportStore.listRuns.mockReturnValue([]);
    const app = buildApp({ sub: 'user-1' });
    await request(app).get('/api/agent-flow-history?limit=9999').expect(200);
    expect(reportStore.listRuns).toHaveBeenCalledWith('user-1', { limit: 200 });
  });
});

describe('GET /api/agent-flow-history/:runId', () => {
  it('401s with no authenticated user', async () => {
    const app = buildApp(null);
    await request(app).get('/api/agent-flow-history/run_1').expect(401);
    expect(reportStore.getRun).not.toHaveBeenCalled();
  });

  it('404s when the run is not found for this user', async () => {
    reportStore.getRun.mockReturnValue(null);
    const app = buildApp({ sub: 'user-1' });
    await request(app).get('/api/agent-flow-history/run_missing').expect(404);
    expect(reportStore.getRun).toHaveBeenCalledWith('user-1', 'run_missing');
  });

  it('returns the run scoped to the authenticated user', async () => {
    reportStore.getRun.mockReturnValue({ runId: 'run_1', userId: 'user-1', prompt: 'hi' });
    const app = buildApp({ sub: 'user-1' });
    const res = await request(app).get('/api/agent-flow-history/run_1').expect(200);
    expect(res.body.run.prompt).toBe('hi');
  });

  it('never leaks another user\'s run — getRun is always called with the caller\'s own sub', async () => {
    reportStore.getRun.mockReturnValue(null);
    const app = buildApp({ sub: 'attacker' });
    await request(app).get('/api/agent-flow-history/victim-run').expect(404);
    expect(reportStore.getRun).toHaveBeenCalledWith('attacker', 'victim-run');
  });
});
