'use strict';
const request = require('supertest');
const express = require('express');

const webhookRouter = require('../routes/webhookPingOne');
const pingoneEventStore = require('../services/lmdb/pingoneEventStore.lmdb');
const appEventService = require('../services/appEventService');

afterEach(() => pingoneEventStore.clear());

function makeApp() {
  const app = express();
  app.use('/webhook', express.json());
  app.use('/webhook', webhookRouter);
  return app;
}

const VALID_EVENT = {
  id: 'evt-1',
  type: 'AUTHENTICATION',
  actors: { user: { id: 'user-1', type: 'USER' } },
  resources: [{ id: 'res-1', type: 'USER', name: 'Alice' }],
  result: { status: 'SUCCESS' },
  _embedded: { environment: { id: 'env-1' } },
  recordedAt: '2026-08-06T10:00:00.000Z',
};

// Captured verbatim from a real PingOne "Test Connection" delivery. The event
// type is at action.type, NOT at the top level, and _embedded is empty — the
// environment is carried on the actor. Both cost us a 400 in production.
const REAL_PING_ACTIVITY_EVENT = {
  id: '81943c49-5435-48cd-937a-f9b8a7b7982f',
  recordedAt: '2026-08-09T02:24:24.507594727Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  actors: {
    client: { id: 'ADMIN', name: 'ADMIN', type: 'CLIENT' },
    user: {
      id: 'user-abc',
      name: 'test@pingidentity.com',
      environment: { id: 'env-from-actor' },
      type: 'USER',
    },
  },
  source: { userAgent: 'Test Connection Client' },
  action: { type: 'EVENT_DELIVERY_TEST', description: 'Test event for subscription delivery' },
  resources: [{ type: 'USER', id: 'res-abc', name: 'NR2' }],
  result: { status: 'SUCCESS', description: 'test connection' },
  _embedded: {},
  subscriptionName: 'NR2',
};

const SECOND_EVENT = {
  id: 'evt-2',
  type: 'USER.CREATED',
  actors: { user: { id: 'user-2', type: 'USER' } },
  result: { status: 'SUCCESS' },
  recordedAt: '2026-08-06T10:00:05.000Z',
};

// The regression this change exists for: before it, a real PingOne delivery
// 400'd because the route looked for a top-level `type`.
test('real Ping Activity payload maps action.type and persists', async () => {
  const res = await request(makeApp())
    .post('/webhook/pingone')
    .send([REAL_PING_ACTIVITY_EVENT]);
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(1);
  const [stored] = pingoneEventStore.query({ limit: 10 });
  expect(stored.eventType).toBe('EVENT_DELIVERY_TEST');
  expect(stored.actorId).toBe('user-abc');
  expect(stored.status).toBe('SUCCESS');
  expect(stored.resource).toBe('NR2');
  // _embedded is {} on real payloads — environment comes off the actor.
  expect(stored.environmentId).toBe('env-from-actor');
  expect(stored.correlationId).toBe('11111111-2222-3333-4444-555555555555');
});

test('HEAD /pingone returns 200 so Test Connection succeeds', async () => {
  const res = await request(makeApp()).head('/webhook/pingone');
  expect(res.status).toBe(200);
});

test('event with neither action.type nor type returns 400', async () => {
  const res = await request(makeApp())
    .post('/webhook/pingone')
    .send([{ id: 'x', action: { description: 'no type here' } }]);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
});

test('single event with no auth header returns 200 and persists', async () => {
  const res = await request(makeApp()).post('/webhook/pingone').send(VALID_EVENT);
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(1);
  const stored = pingoneEventStore.query({ limit: 10 });
  expect(stored.length).toBe(1);
  expect(stored[0].eventType).toBe('AUTHENTICATION');
});

// The behavior change this route exists to make: PingOne cannot sign a body, so
// the endpoint is deliberately open. A request carrying no credentials at all,
// and one carrying a bogus signature header, must both be accepted.
test('open ingest — a bogus x-p1-signature is ignored, not rejected', async () => {
  const res = await request(makeApp())
    .post('/webhook/pingone')
    .set('x-p1-signature', 'deadbeef')
    .send(VALID_EVENT);
  expect(res.status).toBe(200);
  expect(pingoneEventStore.query({ limit: 10 }).length).toBe(1);
});

test('batch array persists every event in the batch', async () => {
  const res = await request(makeApp())
    .post('/webhook/pingone')
    .send([VALID_EVENT, SECOND_EVENT]);
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
  expect(res.body.eventIds).toHaveLength(2);
  const types = pingoneEventStore.query({ limit: 10 }).map((e) => e.eventType).sort();
  expect(types).toEqual(['AUTHENTICATION', 'USER.CREATED']);
});

test('batch keeps the valid events and drops malformed ones', async () => {
  const res = await request(makeApp())
    .post('/webhook/pingone')
    .send([VALID_EVENT, { id: 'no-type' }, SECOND_EVENT]);
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
  expect(pingoneEventStore.query({ limit: 10 }).length).toBe(2);
});

test('event without a type returns 400', async () => {
  const res = await request(makeApp()).post('/webhook/pingone').send({ id: 'x' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
  expect(pingoneEventStore.query({ limit: 10 }).length).toBe(0);
});

test('empty batch returns 400 and stores nothing', async () => {
  const res = await request(makeApp()).post('/webhook/pingone').send([]);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
  expect(pingoneEventStore.query({ limit: 10 }).length).toBe(0);
});

test('appEventService.logEvent called once per event in a batch', async () => {
  const logSpy = jest.spyOn(appEventService, 'logEvent').mockImplementation(() => {});
  await request(makeApp()).post('/webhook/pingone').send([VALID_EVENT, SECOND_EVENT]);
  expect(logSpy).toHaveBeenCalledTimes(2);
  expect(logSpy).toHaveBeenCalledWith(
    'pingone',
    'info',
    expect.stringContaining('AUTHENTICATION'),
    expect.objectContaining({ tag: 'pingone/event' })
  );
  logSpy.mockRestore();
});
