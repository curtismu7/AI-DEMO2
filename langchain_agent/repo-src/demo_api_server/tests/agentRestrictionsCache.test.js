'use strict';

jest.useFakeTimers();

const { AgentRestrictionsCache } = require('../middleware/agentRestrictionsCache');

describe('AgentRestrictionsCache', () => {
  let cache;

  beforeEach(() => {
    cache = new AgentRestrictionsCache({ ttlMs: 5000 });
  });

  test('returns null for unknown user', () => {
    expect(cache.get('user-1')).toBeNull();
  });

  test('returns cached value within TTL', () => {
    cache.set('user-1', 'write');
    expect(cache.get('user-1')).toBe('write');
  });

  test('returns null after TTL expires', () => {
    cache.set('user-1', 'read');
    jest.advanceTimersByTime(5001);
    expect(cache.get('user-1')).toBeNull();
  });

  test('invalidate removes entry', () => {
    cache.set('user-1', 'none');
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeNull();
  });
});
