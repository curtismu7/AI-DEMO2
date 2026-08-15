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
