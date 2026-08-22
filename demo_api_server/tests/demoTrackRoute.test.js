'use strict';
const express = require('express');
const request = require('supertest');
const svc = require('../services/demoTrackService');

function app() {
  const a = express();
  a.use(express.json());
  // Route is mounted behind authenticateToken in server.js; test the router bare.
  a.use('/api/demo-track', require('../routes/demoTrack'));
  return a;
}

describe('demo track route', () => {
  beforeEach(() => {
    jest.resetModules();
    const freshSvc = require('../services/demoTrackService');
    freshSvc._resetForTests();
  });

  test('GET returns track definition and active run', async () => {
    const res = await request(app()).get('/api/demo-track');
    expect(res.status).toBe(200);
    expect(res.body.track.steps).toHaveLength(9);
    expect(res.body.run.runId).toMatch(/^run-/);
  });

  test('POST /runs starts a fresh run; GET /runs lists the archived one', async () => {
    const a = app();
    const r1 = await request(a).get('/api/demo-track');
    const res = await request(a).post('/api/demo-track/runs');
    expect(res.status).toBe(200);
    expect(res.body.run.runId).not.toBe(r1.body.run.runId);
    const hist = await request(a).get('/api/demo-track/runs');
    expect(hist.body.runs[0].runId).toBe(r1.body.run.runId);
  });

  test('POST /active-step sets the active step; unknown step is a no-op 200', async () => {
    const res = await request(app()).post('/api/demo-track/active-step').send({ stepId: 'step-up' });
    expect(res.status).toBe(200);
    expect(res.body.run.activeStepId).toBe('step-up');
  });

  test('POST /arm arms one slot for the wildcard and makes its step active', async () => {
    const a = app();
    const res = await request(a).post('/api/demo-track/arm').send({ stepId: 'mcp-gateway', color: 'green' });
    expect(res.status).toBe(200);
    expect(res.body.run.activeStepId).toBe('mcp-gateway');
    expect(res.body.run.arm).toMatchObject({ stepId: 'mcp-gateway', color: 'green' });
  });
});

// Regression: two concurrent presenter sessions shared one process-global run
// (services/demoTrackService.js's old bare `let _run`), so one session's
// "Start New Run" silently archived and wiped out another session's
// in-progress walkthrough, and unrelated traffic from either session stamped
// the same track. The fix scopes state by req.sessionID.
function appWithSession() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.sessionID = req.headers['x-test-session-id'];
    next();
  });
  a.use('/api/demo-track', require('../routes/demoTrack'));
  return a;
}

describe('demo track route — session isolation', () => {
  beforeEach(() => {
    jest.resetModules();
    const freshSvc = require('../services/demoTrackService');
    freshSvc._resetForTests('session-a');
    freshSvc._resetForTests('session-b');
  });

  test('two sessions get independent runs and one starting a new run does not touch the other', async () => {
    const a = appWithSession();
    const asA = (method, path) => request(a)[method](path).set('x-test-session-id', 'session-a');
    const asB = (method, path) => request(a)[method](path).set('x-test-session-id', 'session-b');

    const initialA = await asA('get', '/api/demo-track');
    const initialB = await asB('get', '/api/demo-track');
    expect(initialA.body.run.runId).not.toBe(initialB.body.run.runId);

    await asA('post', '/api/demo-track/arm').send({ stepId: 'mcp-gateway', color: 'green' });

    // Session B's own run is untouched by A's arm.
    const stateB = await asB('get', '/api/demo-track');
    expect(stateB.body.run.arm).toBeUndefined();
    expect(stateB.body.run.runId).toBe(initialB.body.run.runId);

    // Session A starting a fresh run archives only A's run — B keeps running.
    await asA('post', '/api/demo-track/runs');
    const historyA = await asA('get', '/api/demo-track/runs');
    const historyB = await asB('get', '/api/demo-track/runs');
    expect(historyA.body.runs[0].runId).toBe(initialA.body.run.runId);
    expect(historyB.body.runs).toHaveLength(0);
    const stillB = await asB('get', '/api/demo-track');
    expect(stillB.body.run.runId).toBe(initialB.body.run.runId);
  });
});
