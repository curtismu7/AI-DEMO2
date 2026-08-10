'use strict';
const store = require('../services/lmdb/agentLifecycleEventStore.lmdb');

afterEach(() => store.clear());

test('append stores an event and query returns it newest-first', () => {
  store.append({ eventType: 'joiner', agentId: 'chatgpt', source: 'azure' });
  store.append({ eventType: 'leaver', agentId: 'glean', source: 'gcp' });
  const results = store.query({ limit: 10 });
  expect(results.length).toBe(2);
  expect(results[0].eventType).toBe('leaver'); // newest first
});

test('query filters by eventType', () => {
  store.append({ eventType: 'joiner', agentId: 'chatgpt' });
  store.append({ eventType: 'leaver', agentId: 'glean' });
  const results = store.query({ eventType: 'joiner' });
  expect(results.length).toBe(1);
  expect(results[0].agentId).toBe('chatgpt');
});

test('query filters by agentId', () => {
  store.append({ eventType: 'joiner', agentId: 'chatgpt' });
  store.append({ eventType: 'joiner', agentId: 'glean' });
  const results = store.query({ agentId: 'glean' });
  expect(results.length).toBe(1);
  expect(results[0].agentId).toBe('glean');
});

test('summary returns correct totals', () => {
  store.append({ eventType: 'joiner', agentId: 'chatgpt' });
  store.append({ eventType: 'joiner', agentId: 'glean' });
  store.append({ eventType: 'leaver', agentId: 'chatgpt' });
  const s = store.summary();
  expect(s.totalEvents).toBe(3);
  expect(s.byEventType.joiner).toBe(2);
  expect(s.byEventType.leaver).toBe(1);
});

test('append adds eventId and timestamp when absent', () => {
  const ev = store.append({ eventType: 'joiner', agentId: 'chatgpt' });
  expect(typeof ev.eventId).toBe('string');
  expect(typeof ev.timestamp).toBe('string');
});
