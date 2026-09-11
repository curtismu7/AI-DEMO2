'use strict';

// The persisted half of services/privilegeGatewaySession.js. openEnv is faked
// with a Map, as in privilegeDoorStore.test.js: what is worth pinning is this
// module's key layout, not the LMDB binding twenty other stores exercise.

const mockDb = new Map();

jest.mock('../../services/lmdb/openEnv', () => ({
  getDb: () => ({
    getRange: () => [...mockDb].map(([key, value]) => ({ key, value })),
    putSync: (k, v) => { mockDb.set(k, v); return true; },
    removeSync: (k) => mockDb.delete(k),
  }),
}));

const store = require('../../services/lmdb/privilegeGatewaySessionStore.lmdb');

beforeEach(() => mockDb.clear());

describe('privilegeGatewaySessionStore', () => {
  test('stores one record per app and reads them all back', () => {
    store.save('opensearch', { accessToken: 'a' });
    store.save('opensearch22', { accessToken: 'b' });

    expect(store.loadAll()).toEqual({
      opensearch: { accessToken: 'a' },
      opensearch22: { accessToken: 'b' },
    });
  });

  test('remove drops only that app', () => {
    store.save('opensearch', { accessToken: 'a' });
    store.save('opensearch22', { accessToken: 'b' });

    store.remove('opensearch');

    expect(store.loadAll()).toEqual({ opensearch22: { accessToken: 'b' } });
  });
});
