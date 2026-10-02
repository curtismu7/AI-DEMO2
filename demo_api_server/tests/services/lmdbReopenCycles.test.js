'use strict';

// Regression for TECH_DEBT 2026-09-09 (1): setup.js's afterEach runs
// jest.resetModules(), so each test opens a fresh LMDB environment on the same
// path. Left unclosed, those pile up reader slots until the 126-slot pool is
// gone and an unrelated suite dies with MDB_READERS_FULL. 200 tests > 126, so
// this file fails on its own without the open() tracking in setup.js.
describe('LMDB env opened once per test (module registry reset between tests)', () => {
  test.each(Array.from({ length: 200 }, (_, i) => [i]))('reopen cycle %i reads and writes', (i) => {
    const { getDb } = require('../../services/lmdb/openEnv');
    const db = getDb('conversations');
    db.putSync(`reopen-${i}`, { i });
    expect(db.get(`reopen-${i}`)).toEqual({ i });
  });
});
