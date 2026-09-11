'use strict';

// The log half of this router talks to the docker socket; it is not under test.
jest.mock('../../services/agentGatewayLogs', () => ({
  GATEWAY_CONTAINER: 'ai-demo-ping-gateway',
  fetchLogs: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const agentGatewayDecisions = require('../../services/agentGatewayDecisions');
const router = require('../../routes/agentGatewayLogs');

// Stands in for authenticateToken, which server.js applies at the /api/admin mount.
function appAs(user) {
  const a = express();
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api/admin', router);
  return a;
}

function trailFor(sub) {
  return {
    introspection: { sub, client_id: `app-${sub}`, email: `${sub}@example.com` },
    authorize: { decision: 'DENY', backend: 'real', method: 'initialize' },
  };
}

describe('GET /api/admin/agent-gateway/decisions — who sees which decisions', () => {
  beforeEach(() => {
    agentGatewayDecisions.clear();
    agentGatewayDecisions.record(trailFor('user-1'));
    agentGatewayDecisions.record(trailFor('user-2'));
  });

  test('a non-admin sees only decisions about their own sub', async () => {
    const res = await request(appAs({ sub: 'user-1', role: 'customer' }))
      .get('/api/admin/agent-gateway/decisions');
    expect(res.status).toBe(200);
    expect(res.body.decisions.map((d) => d.sub)).toEqual(['user-1']);
  });

  test('an admin sees every caller, newest first', async () => {
    const res = await request(appAs({ sub: 'admin-1', role: 'admin' }))
      .get('/api/admin/agent-gateway/decisions');
    expect(res.body.decisions.map((d) => d.sub)).toEqual(['user-2', 'user-1']);
  });

  test('a user with no resolvable identity sees nothing', async () => {
    const res = await request(appAs({ role: 'customer' }))
      .get('/api/admin/agent-gateway/decisions');
    expect(res.body.decisions).toEqual([]);
  });

  test("a user's own decision is not crowded out by other callers' newer ones", async () => {
    // 10 newer user-2 decisions: all still in the buffer (well under MAX), but
    // more than the requested limit. Slicing to the limit BEFORE filtering would
    // return five user-2 entries, filter them all away, and show user-1 nothing.
    for (let i = 0; i < 10; i += 1) {
      agentGatewayDecisions.record(trailFor('user-2'));
    }
    const res = await request(appAs({ sub: 'user-1', role: 'customer' }))
      .get('/api/admin/agent-gateway/decisions?limit=5');
    expect(res.body.decisions.map((d) => d.sub)).toEqual(['user-1']);
  });
});
