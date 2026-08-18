'use strict';

/**
 * POST /:userId/:vertical/hero-shown — end-to-end route + real store.
 *
 * This is the endpoint the live dashboard 500 was reported on
 * (`POST /api/conversations/me/retail/hero-shown -> 500`). The real cause was
 * the store's prune path calling the non-existent `db.deleteSync()` (fixed to
 * `removeSync` in PR #1976); it fired on `demouser:retail` because that thread
 * had grown past the per-thread prune cap, so EVERY hero-shown write triggered
 * the throw. `conversationStoreDelete.test.js` guards the store call directly;
 * no test drove the failure THROUGH the route, where two more invariants matter:
 *
 *   1. the `me` alias resolves to `req.user.sub` before the store is touched, so
 *      the greeting persists under the real subject id, never under literal `me`;
 *   2. a hero-shown write that lands on an at-cap thread runs the prune and still
 *      returns 200 — the exact shape that 500'd in production.
 *
 * Uses the REAL LMDB store against an isolated LMDB_PATH so persistence and the
 * prune path are exercised for real, not mocked away.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-shown-'));
process.env.LMDB_PATH = tmpDir; // must be set before the store opens its env

const request = require('supertest');
const express = require('express');
const store = require('../../services/lmdb/conversationStore.lmdb');
const router = require('../../routes/conversations');

const SUB = 'sub-abc-123';
const VERTICAL = 'retail';

function appAsUser() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { sub: SUB, role: 'user' };
    next();
  });
  app.use('/api/conversations', router);
  return app;
}

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('POST hero-shown — resolves `me` and persists under the subject id', () => {
  test('returns 200 and stores the greeting under req.user.sub, not "me"', async () => {
    const body = { greeting: 'Welcome back to Great Buy!', imageUrl: 'https://cdn.example/hero.png' };

    const res = await request(appAsUser())
      .post(`/api/conversations/me/${VERTICAL}/hero-shown`)
      .send(body)
      .expect(200);
    expect(res.body).toEqual({ saved: true });

    // Persisted under the resolved subject id...
    const underSub = store.getHistory(SUB, VERTICAL, 50);
    const hero = underSub.find((m) => m.heroGreeting === true);
    expect(hero).toBeTruthy();
    expect(hero.content).toBe(body.greeting);
    expect(hero.imageUrl).toBe(body.imageUrl);
    expect(hero.role).toBe('assistant');

    // ...and nothing under the literal placeholder.
    expect(store.getHistory('me', VERTICAL, 50)).toHaveLength(0);
  });

  test('missing imageUrl is a 400, never a 500', async () => {
    await request(appAsUser())
      .post(`/api/conversations/me/${VERTICAL}/hero-shown`)
      .send({ greeting: 'no image here' })
      .expect(400);
  });
});

describe('POST hero-shown — a write onto an at-cap thread runs the prune and still succeeds', () => {
  // Reproduces the live scenario: the reported 500 fired because the write
  // triggered the prune (removeSync) path on an over-cap thread.
  const HEAVY_SUB = 'sub-heavy-thread';

  function heavyApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { sub: HEAVY_SUB, role: 'user' }; next(); });
    app.use('/api/conversations', router);
    return app;
  }

  test('hero-shown on a thread already at the cap returns 200 (prune path exercised)', async () => {
    const cap = store.MAX_MESSAGES_PER_THREAD;
    const base = Date.now();
    // Seed exactly `cap` messages so the next write (the hero-shown POST) is the
    // one that crosses the cap and triggers the prune.
    for (let i = 0; i < cap; i += 1) {
      store.saveMessage(HEAVY_SUB, VERTICAL, 'assistant', `seed ${i}`, { timestamp: base + i });
    }

    const res = await request(heavyApp())
      .post(`/api/conversations/me/${VERTICAL}/hero-shown`)
      .send({ greeting: 'hero over the cap', imageUrl: 'https://cdn.example/hero2.png' })
      .expect(200);
    expect(res.body).toEqual({ saved: true });

    // Prune kept the thread at the cap, and the newest entry is the hero greeting.
    expect(store.getThreadSize(HEAVY_SUB, VERTICAL)).toBe(cap);
    const newest = store.getHistory(HEAVY_SUB, VERTICAL, 1)[0];
    expect(newest.heroGreeting).toBe(true);
  });
});
