'use strict';

const davinciEventStore = require('../../services/lmdb/davinciEventStore.lmdb');

describe('davinciEventStore', () => {
  beforeEach(() => davinciEventStore.clear());

  test('append assigns eventId and timestamp when absent, query returns newest-first', () => {
    const first = davinciEventStore.append({ eventType: 'fraud_alert', username: 'u1' });
    const second = davinciEventStore.append({ eventType: 'transaction_decision', username: 'u1', decision: 'PERMIT' });

    expect(first.eventId).toBeTruthy();
    expect(first.timestamp).toBeTruthy();

    const results = davinciEventStore.query();
    expect(results[0].eventId).toBe(second.eventId);
    expect(results[1].eventId).toBe(first.eventId);
  });

  test('query filters by eventType', () => {
    davinciEventStore.append({ eventType: 'fraud_alert', username: 'u1' });
    davinciEventStore.append({ eventType: 'transaction_decision', username: 'u1' });

    const results = davinciEventStore.query({ eventType: 'fraud_alert' });
    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe('fraud_alert');
  });
});
