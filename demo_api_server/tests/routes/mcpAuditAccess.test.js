'use strict';

// The store is LMDB-backed; the route's ownership rule is what is under test,
// so the store is replaced with the two calls the route makes.
jest.mock('../../services/lmdb/mcpAuditStore.lmdb', () => {
  const events = [
    { eventId: 'e3', userId: 'user-2', outcome: 'success' },
    { eventId: 'e2', userId: 'user-1', outcome: 'denied' },
    { eventId: 'e1', userId: null, outcome: 'success' },
  ];
  const mine = (userId) => events.filter((e) => !userId || e.userId === userId);
  return {
    query: jest.fn(({ userId }) => mine(userId)),
    summary: jest.fn((userId) => ({ totalEvents: mine(userId).length, byEventType: {}, byOutcome: {} })),
  };
});

const express = require('express');
const request = require('supertest');
const router = require('../../routes/mcpAudit');

// Stands in for requireSession, which server.js applies at the /api/mcp/audit mount.
function appAs(user) {
  const a = express();
  a.use((req, _res, next) => { req.session = { user }; next(); });
  a.use('/api/mcp/audit', router);
  return a;
}

describe('GET /api/mcp/audit — who sees which events', () => {
  test('a non-admin sees only events stamped with their own sub', async () => {
    const res = await request(appAs({ oauthId: 'user-1', role: 'customer' })).get('/api/mcp/audit');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.eventId)).toEqual(['e2']);
  });

  test("a non-admin's summary counts only their own events", async () => {
    const res = await request(appAs({ oauthId: 'user-1', role: 'customer' })).get('/api/mcp/audit?summary=1');
    expect(res.body.totalEvents).toBe(1);
  });

  test('an admin sees every caller', async () => {
    const res = await request(appAs({ oauthId: 'admin-1', role: 'admin' })).get('/api/mcp/audit');
    expect(res.body.map((e) => e.eventId)).toEqual(['e3', 'e2', 'e1']);
    const summary = await request(appAs({ oauthId: 'admin-1', role: 'admin' })).get('/api/mcp/audit?summary=1');
    expect(summary.body.totalEvents).toBe(3);
  });

  test('a non-admin with no resolvable identity sees nothing, not everything', async () => {
    const res = await request(appAs({ role: 'customer' })).get('/api/mcp/audit');
    expect(res.body).toEqual([]);
    const summary = await request(appAs({ role: 'customer' })).get('/api/mcp/audit?summary=1');
    expect(summary.body.totalEvents).toBe(0);
  });
});
