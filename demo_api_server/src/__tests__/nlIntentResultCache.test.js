// demo_api_server/src/__tests__/nlIntentResultCache.test.js
'use strict';

const cache = require('../../services/nlIntentResultCache');

describe('nlIntentResultCache', () => {
  beforeEach(() => {
    cache.clear();
    cache.configure({ ttlMs: 60_000, maxEntries: 3 });
  });

  it('returns null for unknown keys', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('stores and returns successful LLM results', () => {
    const key = cache.key({ message: 'What is OAuth?', vertical: 'banking', provider: 'llamacpp' });
    const value = { source: 'llamacpp', result: { kind: 'education', message: 'delegated auth' } };
    cache.set(key, value);
    expect(cache.get(key)).toEqual(value);
  });

  it('skips kind:none and empty values', () => {
    const key = cache.key({ message: '???', vertical: 'banking', provider: 'llamacpp' });
    cache.set(key, { source: 'llamacpp', result: { kind: 'none' } });
    cache.set(key, null);
    expect(cache.get(key)).toBeNull();
  });

  it('evicts oldest entries when maxEntries is exceeded', () => {
    for (let i = 0; i < 4; i += 1) {
      const key = cache.key({ message: `msg-${i}`, vertical: 'banking', provider: 'llamacpp' });
      cache.set(key, { source: 'llamacpp', result: { kind: 'banking', banking: { action: `a${i}` } } });
    }
    expect(cache.size()).toBe(3);
    expect(cache.get(cache.key({ message: 'msg-0', vertical: 'banking', provider: 'llamacpp' }))).toBeNull();
    expect(cache.get(cache.key({ message: 'msg-3', vertical: 'banking', provider: 'llamacpp' }))).toBeTruthy();
  });

  it('normalizes message whitespace in keys', () => {
    const a = cache.key({ message: '  Show   Balance ', vertical: 'banking', provider: 'auto' });
    const b = cache.key({ message: 'show balance', vertical: 'banking', provider: 'auto' });
    expect(a).toBe(b);
  });
});
