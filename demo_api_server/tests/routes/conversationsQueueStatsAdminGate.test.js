'use strict';
/**
 * GET /api/conversations/admin/queue-stats is admin-only. It carries no
 * :userId, so the router.param ownership guard never fires and the role gate
 * is the only thing in front of it. Pins the exact non-admin response so the
 * gate can move between an inline check and a named guard unchanged.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({}));
jest.mock('../../services/summarizationQueue', () => ({ getStats: jest.fn() }));

const summarizationQueue = require('../../services/summarizationQueue');
const router = require('../../routes/conversations');

function appAs(user) {
  const app = express();
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/conversations', router);
  return app;
}

const DENIED = { error: 'forbidden: admin only' };

describe('GET /api/conversations/admin/queue-stats admin gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a non-admin gets 403 and the queue is never read', async () => {
    const res = await request(appAs({ sub: 'u1', role: 'user' })).get('/api/conversations/admin/queue-stats');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(DENIED);
    expect(summarizationQueue.getStats).not.toHaveBeenCalled();
  });

  test('a request with no user gets the same 403', async () => {
    const res = await request(appAs(null)).get('/api/conversations/admin/queue-stats');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(DENIED);
  });

  test('an admin reaches the handler', async () => {
    summarizationQueue.getStats.mockReturnValue({ queueLength: 0 });
    const res = await request(appAs({ sub: 'a1', role: 'admin' })).get('/api/conversations/admin/queue-stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queueStats: { queueLength: 0 } });
  });
});
