'use strict';
/**
 * Idempotency middleware — the Idempotent Consumer pattern on the money path.
 *
 * Exercised against a bare route rather than POST /api/transactions on purpose:
 * the middleware is the unit under test, and standing up the real route would
 * drag in auth, configStore and PingOne introspection without testing one extra
 * line of this file.
 */

const express = require('express');
const request = require('supertest');
const dataStore = require('../data/store');
const { idempotency } = require('../middleware/idempotency');

// Builds an app whose handler counts how many times it actually ran — the only
// question that matters here. `hooks.before` lets one test hold a request open.
function buildApp(handler) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-a' };
    next();
  });
  app.post('/txn', idempotency, handler);
  return app;
}

describe('idempotency middleware', () => {
  beforeAll(() => jest.spyOn(dataStore, 'persistAllData').mockResolvedValue());
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => dataStore.idempotencyKeys.clear());

  it('is a no-op without the header — two posts, two transfers', async () => {
    let runs = 0;
    const app = buildApp((_req, res) => { runs += 1; res.status(201).json({ id: `txn-${runs}` }); });

    await request(app).post('/txn').send({ amount: 10 }).expect(201);
    await request(app).post('/txn').send({ amount: 10 }).expect(201);

    expect(runs).toBe(2);
    expect(dataStore.idempotencyKeys.size).toBe(0);
  });

  it('replays the first response instead of moving funds again', async () => {
    let runs = 0;
    const app = buildApp((_req, res) => { runs += 1; res.status(201).json({ id: `txn-${runs}`, balance: 900 }); });

    const first = await request(app).post('/txn').set('Idempotency-Key', 'k1').send({ amount: 100 }).expect(201);
    const second = await request(app).post('/txn').set('Idempotency-Key', 'k1').send({ amount: 100 }).expect(201);

    expect(runs).toBe(1);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
  });

  // The one that makes the key safe to accept from a client at all: without
  // per-user scoping, guessing a key reads back someone else's transfer.
  it('does not let one user replay another user\'s key', async () => {
    let runs = 0;
    const app = buildApp((req, res) => { runs += 1; res.status(201).json({ owner: req.user.id }); });

    await request(app).post('/txn').set('Idempotency-Key', 'shared').set('x-test-user', 'user-a').expect(201);
    const bob = await request(app).post('/txn').set('Idempotency-Key', 'shared').set('x-test-user', 'user-b').expect(201);

    expect(runs).toBe(2);
    expect(bob.body.owner).toBe('user-b');
    expect(bob.headers['idempotency-replayed']).toBeUndefined();
  });

  it('replays a settled 4xx refusal verbatim', async () => {
    let runs = 0;
    const app = buildApp((_req, res) => { runs += 1; res.status(400).json({ error: 'amount_exceeds_hard_limit' }); });

    await request(app).post('/txn').set('Idempotency-Key', 'k4').expect(400);
    const replay = await request(app).post('/txn').set('Idempotency-Key', 'k4').expect(400);

    expect(runs).toBe(1);
    expect(replay.body.error).toBe('amount_exceeds_hard_limit');
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  // A 5xx is "we don't know", not "no". Caching it would strand the client on a
  // failure forever; the retry has to be allowed through.
  it('releases the key after a 5xx so a real retry can proceed', async () => {
    let runs = 0;
    const app = buildApp((_req, res) => {
      runs += 1;
      if (runs === 1) return res.status(502).json({ error: 'upstream_unavailable' });
      return res.status(201).json({ id: 'txn-ok' });
    });

    await request(app).post('/txn').set('Idempotency-Key', 'k5').expect(502);
    const retry = await request(app).post('/txn').set('Idempotency-Key', 'k5').expect(201);

    expect(runs).toBe(2);
    expect(retry.body.id).toBe('txn-ok');
  });

  // The actual double-click: both requests in flight, neither committed. A
  // check-then-write design lets both through; reserve-then-fill collides.
  it('rejects a duplicate that arrives while the first is still in flight', async () => {
    let runs = 0;
    let release;
    let markEntered;
    const held = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { markEntered = resolve; });
    const app = buildApp(async (_req, res) => {
      runs += 1;
      markEntered();
      await held;
      res.status(201).json({ id: 'txn-1' });
    });

    // .then() is what makes supertest actually send; without it the "first"
    // request never leaves the starting line and there is nothing to collide with.
    const inFlight = request(app).post('/txn').set('Idempotency-Key', 'k6').send({ amount: 5 }).then((r) => r);
    await entered;

    const duplicate = await request(app).post('/txn').set('Idempotency-Key', 'k6').send({ amount: 5 }).expect(409);
    expect(duplicate.body.error).toBe('idempotent_request_in_progress');

    release();
    expect((await inFlight).status).toBe(201);
    expect(runs).toBe(1);
  });

  // Node trims header values, so a whitespace-only key is indistinguishable from
  // no key at all by the time it reaches us — the honest behaviour is the no-op,
  // not a 400 about a header the client can't tell apart from omitting it.
  it('treats a whitespace-only key as absent and refuses an oversized one', async () => {
    const app = buildApp((_req, res) => res.status(201).json({ ok: true }));

    await request(app).post('/txn').set('Idempotency-Key', '   ').expect(201);
    await request(app).post('/txn').set('Idempotency-Key', 'x'.repeat(201)).expect(400);
    expect(dataStore.idempotencyKeys.size).toBe(0);
  });

  it('persists only settled records, never an in-flight reservation', () => {
    dataStore.idempotencyKeys.set('u:done', { key: 'u:done', state: 'completed', status: 201, body: { id: 'a' } });
    dataStore.idempotencyKeys.set('u:busy', { key: 'u:busy', state: 'in_progress' });

    const keys = dataStore.getSnapshot().idempotencyKeys;
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe('u:done');
  });
});
