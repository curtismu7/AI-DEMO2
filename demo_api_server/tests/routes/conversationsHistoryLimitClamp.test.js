'use strict';
/**
 * GET /:userId/:vertical/history — `limit` must be sanitised and clamped.
 *
 * `parseInt(req.query.limit || DEFAULT, 10)` produced NaN for `?limit=abc`, and
 * `Math.min(NaN, 100)` = NaN defeated the cap; negatives passed unclamped. The
 * route now coerces to a finite value (falling back to the default) and clamps
 * into [1, 100] before calling getHistory.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({
  getHistory: jest.fn(() => []),
  DEFAULT_HISTORY_LIMIT: 30,
}));
jest.mock('../../services/summarizationQueue', () => ({ enqueue: jest.fn(), getStats: jest.fn() }));

const conversationStore = require('../../services/lmdb/conversationStore.lmdb');
const router = require('../../routes/conversations');

const app = express();
app.use((req, _res, next) => {
  req.user = { sub: 'u1', role: 'user' };
  next();
});
app.use('/api/conversations', router);

function limitPassed() {
  return conversationStore.getHistory.mock.calls[0][2];
}

describe('GET history — limit sanitisation and clamp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('non-numeric ?limit=abc falls back to the default (30)', async () => {
    await request(app).get('/api/conversations/me/banking/history?limit=abc').expect(200);
    expect(limitPassed()).toBe(30);
  });

  test('negative ?limit=-1 clamps up to 1', async () => {
    await request(app).get('/api/conversations/me/banking/history?limit=-1').expect(200);
    expect(limitPassed()).toBe(1);
  });

  test('oversized ?limit=999 clamps down to the cap (100)', async () => {
    await request(app).get('/api/conversations/me/banking/history?limit=999').expect(200);
    expect(limitPassed()).toBe(100);
  });

  test('a valid in-range ?limit=50 is passed through unchanged', async () => {
    await request(app).get('/api/conversations/me/banking/history?limit=50').expect(200);
    expect(limitPassed()).toBe(50);
  });

  test('missing limit falls back to the default (30)', async () => {
    await request(app).get('/api/conversations/me/banking/history').expect(200);
    expect(limitPassed()).toBe(30);
  });
});
