'use strict';
const store = require('../src/store/challengeStore');

describe('challengeStore correlationId', () => {
  test('persists correlationId on create', () => {
    const ch = store.create({
      tool: 'create_transfer',
      userId: 'u1',
      agentId: 'a1',
      context: { amount: 5000, to_account_id: 'acc-1' },
      correlationId: 'c1',
    });
    expect(ch.correlationId).toBe('c1');
    expect(store.get(ch.id).correlationId).toBe('c1');
  });

  test('correlationId is null when not supplied', () => {
    const ch = store.create({ tool: 'x', userId: 'u1', agentId: 'a1', context: {} });
    expect(ch.correlationId).toBeNull();
  });

  test('resolve preserves correlationId', () => {
    const ch = store.create({ tool: 'x', userId: 'u1', agentId: 'a1', context: {}, correlationId: 'c1' });
    const resolved = store.resolve(ch.id, 'approved');
    expect(resolved.correlationId).toBe('c1');
    expect(resolved.decision).toBe('approved');
  });
});
