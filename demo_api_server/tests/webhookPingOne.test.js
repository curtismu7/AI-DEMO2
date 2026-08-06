'use strict';
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

process.env.PINGONE_WEBHOOK_SECRET = 'test-secret-abc';

const webhookRouter = require('../routes/webhookPingOne');
const pingoneEventStore = require('../services/lmdb/pingoneEventStore.lmdb');

afterEach(() => pingoneEventStore.clear());

function makeApp() {
  const app = express();
  app.use('/webhook', express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  const broadcasts = [];
  app.locals.broadcast = (evt) => broadcasts.push(evt);
  app._broadcasts = broadcasts;
  app.use('/webhook', webhookRouter);
  return app;
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
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

test('valid HMAC + body returns 200 and persists event', async () => {
  const app = makeApp();
  const body = JSON.stringify(VALID_EVENT);
  const sig = sign(body, 'test-secret-abc');
  const res = await request(app)
    .post('/webhook/pingone')
    .set('Content-Type', 'application/json')
    .set('x-p1-signature', sig)
    .send(body);
  expect(res.status).toBe(200);
  const stored = pingoneEventStore.query({ limit: 1 });
  expect(stored.length).toBe(1);
  expect(stored[0].eventType).toBe('AUTHENTICATION');
});

test('missing HMAC returns 401', async () => {
  const app = makeApp();
  const res = await request(app).post('/webhook/pingone').send(VALID_EVENT);
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_signature');
});

test('wrong HMAC returns 401', async () => {
  const app = makeApp();
  const body = JSON.stringify(VALID_EVENT);
  const badSig = sign(body, 'wrong-secret');
  const res = await request(app)
    .post('/webhook/pingone')
    .set('Content-Type', 'application/json')
    .set('x-p1-signature', badSig)
    .send(body);
  expect(res.status).toBe(401);
});

test('missing type field returns 400', async () => {
  const app = makeApp();
  const badEvent = { id: 'x' };
  const body = JSON.stringify(badEvent);
  const sig = sign(body, 'test-secret-abc');
  const res = await request(app)
    .post('/webhook/pingone')
    .set('Content-Type', 'application/json')
    .set('x-p1-signature', sig)
    .send(body);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
});

test('broadcast is called on valid event', async () => {
  const app = makeApp();
  const body = JSON.stringify(VALID_EVENT);
  const sig = sign(body, 'test-secret-abc');
  await request(app)
    .post('/webhook/pingone')
    .set('Content-Type', 'application/json')
    .set('x-p1-signature', sig)
    .send(body);
  expect(app._broadcasts.length).toBe(1);
  expect(app._broadcasts[0].tag).toBe('pingone/event');
});
