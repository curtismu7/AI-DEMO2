'use strict';
const store = require('../services/lmdb/pingoneEventStore.lmdb');

afterEach(() => store.clear());

test('append stores an event and query returns it newest-first', () => {
  store.append({ eventType: 'AUTHENTICATION', actorId: 'u1', status: 'SUCCESS' });
  store.append({ eventType: 'PASSWORD_CHANGED', actorId: 'u2', status: 'SUCCESS' });
  const results = store.query({ limit: 10 });
  expect(results.length).toBe(2);
  expect(results[0].eventType).toBe('PASSWORD_CHANGED'); // newest first
});

test('query filters by eventType', () => {
  store.append({ eventType: 'AUTHENTICATION', actorId: 'u1', status: 'SUCCESS' });
  store.append({ eventType: 'USER_CREATED', actorId: 'u2', status: 'SUCCESS' });
  const results = store.query({ eventType: 'AUTHENTICATION' });
  expect(results.length).toBe(1);
  expect(results[0].eventType).toBe('AUTHENTICATION');
});

test('summary returns correct totals', () => {
  store.append({ eventType: 'AUTHENTICATION', status: 'SUCCESS' });
  store.append({ eventType: 'AUTHENTICATION', status: 'FAILED' });
  store.append({ eventType: 'USER_CREATED', status: 'SUCCESS' });
  const s = store.summary();
  expect(s.totalEvents).toBe(3);
  expect(s.byEventType.AUTHENTICATION).toBe(2);
  expect(s.byEventType.USER_CREATED).toBe(1);
});

test('append adds eventId and timestamp when absent', () => {
  const ev = store.append({ eventType: 'AUTHENTICATION' });
  expect(typeof ev.eventId).toBe('string');
  expect(typeof ev.timestamp).toBe('string');
});
