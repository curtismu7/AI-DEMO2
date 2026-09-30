'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const previousLmdbPath = process.env.LMDB_PATH;
const testLmdbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-txn-store-'));
process.env.LMDB_PATH = testLmdbPath;

const store = require('../services/lmdb/verifyTransactionStore.lmdb');
const { closeEnv } = require('../services/lmdb/openEnv');

afterAll(() => {
  closeEnv();
  if (previousLmdbPath === undefined) delete process.env.LMDB_PATH;
  else process.env.LMDB_PATH = previousLmdbPath;
  fs.rmSync(testLmdbPath, { recursive: true, force: true });
});

describe('verifyTransactionStore', () => {
  const base = {
    id: 'verify-store-transaction',
    appUserId: 'app-user-1',
    pingOneUserId: 'pingone-user-1',
    status: 'REQUESTED',
    expiresAt: '2099-01-01T00:00:00.000Z',
    verifiedAt: null,
    createdAt: '2026-09-29T18:00:00.000Z',
  };

  test('persists only lifecycle and ownership fields', () => {
    store.save({ ...base, selfie: 'face-data', providerResponse: { requirements: { birth_date: 'private' } } });
    expect(store.get(base.id)).toEqual(base);
  });

  test('isolates transaction identifiers and prunes expired lifecycle records', () => {
    store.save({ ...base, id: 'verify-store-expired', expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(store.get('verify-store-transaction').appUserId).toBe('app-user-1');
    expect(store.pruneExpired(Date.parse('2026-09-29T20:00:00.000Z'))).toBe(1);
    expect(store.get('verify-store-expired')).toBeNull();
  });
});
