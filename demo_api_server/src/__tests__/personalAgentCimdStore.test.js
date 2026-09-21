'use strict';

const mockRecords = new Map();
const mockDb = {
  putSync: (key, value) => mockRecords.set(key, value),
  get: (key) => mockRecords.get(key),
  getRange: () => [...mockRecords.entries()].map(([key, value]) => ({ key, value })),
  getKeys: () => [...mockRecords.keys()],
  removeSync: (key) => mockRecords.delete(key),
};

jest.mock('../../services/lmdb/openEnv', () => ({
  openEnv: () => ({ openDB: () => mockDb }),
}));

const store = require('../../services/lmdb/personalAgentCimdStore.lmdb');

beforeEach(() => mockRecords.clear());

test('persists, reads, lists, and clears public-safe personal-agent associations', () => {
  const record = { userKey: 'sub-123', pingoneAgentId: 'agent-123', status: 'registered' };

  store.put(record);

  expect(store.get('sub-123')).toEqual(record);
  expect(store.loadAll()).toEqual([['sub-123', record]]);

  store.remove('sub-123');
  expect(store.get('sub-123')).toBeNull();

  store.put(record);
  store.clearAll();
  expect(store.get('sub-123')).toBeNull();
  expect(store.loadAll()).toEqual([]);
});
