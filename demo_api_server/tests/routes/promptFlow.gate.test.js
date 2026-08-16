'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  listRecords: jest.fn().mockReturnValue([]),
  getRecord: jest.fn().mockReturnValue(null),
}));

const express = require('express');
const request = require('supertest');
const promptFlowRouter = require('../../routes/promptFlow');

// Mirrors the exact admin gate server.js applies at the /api/prompt-flow
// mount point (server.js, immediately after the /api/mcp/audit gate) — the
// router itself carries no auth check, same as routes/mcpAudit.js.
function adminGate(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    return res.status(401).json({
      error: 'admin_required',
      message: 'Admin session required to access prompt flow trace.'
    });
  }
  next();
}

function makeApp(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/prompt-flow', adminGate, promptFlowRouter);
  return app;
}

describe('GET /api/prompt-flow — admin gate', () => {
  test('401 with no session', async () => {
    const res = await request(makeApp(undefined)).get('/api/prompt-flow');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'admin_required',
      message: 'Admin session required to access prompt flow trace.',
    });
  });

  test('401 for a non-admin session', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/prompt-flow');
    expect(res.status).toBe(401);
  });

  test('200 for an admin session', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } })).get('/api/prompt-flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
  });

  test('the gate also protects the detail route', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/prompt-flow/c1');
    expect(res.status).toBe(401);
  });
});
