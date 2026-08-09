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

const SECOND_EVENT = {
  id: 'evt-2',
  type: 'USER.CREATED',
  actors: { user: { id: 'user-2', type: 'USER' } },
  result: { status: 'SUCCESS' },
  recordedAt: '2026-08-06T10:00:05.000Z',
};

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
