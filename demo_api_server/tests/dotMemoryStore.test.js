'use strict';

const { createDotMemoryStore, extractMemories } = require('../services/lmdb/dotMemoryStore.lmdb');

function fakeDb() {
  const data = new Map();
  return {
    putSync: (key, value) => data.set(key, value),
    get: (key) => data.get(key),
    removeSync: (key) => data.delete(key),
    getRange: ({ start, end }) => Array.from(data.entries())
      .filter(([key]) => key >= start && key < end)
      .map(([key, value]) => ({ key, value })),
  };
}

describe('dot memory store', () => {
  test('saves, lists newest-first, and clears per-user memories', () => {
    const store = createDotMemoryStore({ db: fakeDb(), now: () => 1000 });
    store.saveMemory('user-a', 'Always address me as Captain');
    store.saveMemory('user-a', 'Never book the red-eye');
    store.saveMemory('user-b', 'Prefer aisle seats');

    expect(store.getMemories('user-a').map((m) => m.text)).toEqual([
      'Never book the red-eye',
      'Always address me as Captain',
    ]);
    expect(store.getMemories('user-b')).toHaveLength(1);

    store.clearMemories('user-a');
    expect(store.getMemories('user-a')).toEqual([]);
    expect(store.getMemories('user-b')).toHaveLength(1);
  });

  test('rejects empty and oversized memories', () => {
    const store = createDotMemoryStore({ db: fakeDb(), now: () => 1000 });
    expect(store.saveMemory('user-a', '   ')).toBe(false);
    expect(store.saveMemory('user-a', 'x'.repeat(501))).toBe(false);
    expect(store.saveMemory('user-a', 'Keep it short')).toBe(true);
    expect(store.getMemories('user-a')).toHaveLength(1);
  });

  test('caps the per-user memory list', () => {
    const store = createDotMemoryStore({ db: fakeDb(), now: () => 1000 });
    for (let i = 0; i < 55; i += 1) store.saveMemory('user-a', `memory number ${i}`);
    const memories = store.getMemories('user-a');
    expect(memories).toHaveLength(50);
    // Newest kept, oldest evicted.
    expect(memories[0].text).toBe('memory number 54');
  });
});

describe('extractMemories', () => {
  test('captures stated preferences, one per sentence', () => {
    expect(extractMemories('Always use a concise, technical tone. What is my balance?'))
      .toEqual(['Always use a concise, technical tone.']);
    expect(extractMemories('From now on call me Skip. Never book basic economy.'))
      .toEqual(['From now on call me Skip.', 'Never book basic economy.']);
  });

  test('returns nothing for ordinary requests', () => {
    expect(extractMemories('What is my checking balance?')).toEqual([]);
    expect(extractMemories('Book me a flight to Denver next Tuesday')).toEqual([]);
    expect(extractMemories('')).toEqual([]);
  });
});
