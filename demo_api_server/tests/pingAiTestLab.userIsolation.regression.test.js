'use strict';
/**
 * Regression: GET /api/admin/ping-ai-test-lab/results/latest served whoever's
 * `POST /run-all` finished most recently to EVERY signed-in caller — the
 * mount only requires authenticateToken (any user, not admin-only), so two
 * people running this concurrently saw each other's PingOne connectivity
 * and test results (services/pingAiTestLab.js's old bare `let lastRun`).
 *
 * Fix: key the last-run cache by the caller's user id.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn().mockRejectedValue(new Error('no PingOne MCP in test env')),
  callTool: jest.fn().mockRejectedValue(new Error('no PingOne MCP in test env')),
}));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => null) }));

const router = require('../routes/pingAiTestLab');

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    req.session = { user: { id: userId } };
    next();
  });
  app.use('/api/admin/ping-ai-test-lab', router);
  return app;
}

describe('pingAiTestLab.js — per-user last-run isolation', () => {
  test('two different users each see only their own last run', async () => {
    const appAlice = buildApp('alice');
    const appBob = buildApp('bob');

    // Bob has never run anything — 404, not Alice's data.
    const bobBefore = await request(appBob).get('/api/admin/ping-ai-test-lab/results/latest');
    expect(bobBefore.status).toBe(404);

    await request(appAlice).get('/api/admin/ping-ai-test-lab/run-all?suites=mcp');

    const aliceResult = await request(appAlice).get('/api/admin/ping-ai-test-lab/results/latest');
    expect(aliceResult.status).toBe(200);
    expect(aliceResult.body.suites).toEqual(['mcp']);

    // Bob still has no run of his own, even though Alice's just completed.
    const bobAfter = await request(appBob).get('/api/admin/ping-ai-test-lab/results/latest');
    expect(bobAfter.status).toBe(404);
  }, 15000);
});
