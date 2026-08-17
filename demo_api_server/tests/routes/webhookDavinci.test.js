'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../services/lmdb/davinciEventStore.lmdb', () => ({
  append: jest.fn((e) => ({ ...e, eventId: 'dv-test-1', timestamp: '2026-08-17T00:00:00.000Z' })),
}));

const davinciEventStore = require('../../services/lmdb/davinciEventStore.lmdb');
const webhookDavinciRoutes = require('../../routes/webhookDavinci');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookDavinciRoutes);
  return app;
}

describe('POST /webhook/davinci', () => {
  beforeEach(() => davinciEventStore.append.mockClear());

  test('valid fraud_alert event is stored and 200s', async () => {
    const res = await request(buildApp())
      .post('/webhook/davinci')
      .send({ eventType: 'fraud_alert', username: 'demoUser', amount: 15000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, eventId: 'dv-test-1' });
    expect(davinciEventStore.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'fraud_alert', username: 'demoUser', amount: 15000 }),
    );
  });

  test('missing eventType is rejected', async () => {
    const res = await request(buildApp()).post('/webhook/davinci').send({ username: 'demoUser' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_event' });
    expect(davinciEventStore.append).not.toHaveBeenCalled();
  });
});
