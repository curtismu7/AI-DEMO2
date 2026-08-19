'use strict';
// Reports were the only LMDB store with NO prune, and the largest live
// consumer of the shared 128MB env (966 runs = 14.9MB, measured 2026-08-18 —
// TECH_DEBT "The LMDB store is at 66% of a hard 128MB ceiling"). This pins the
// cap: new runs past MAX_REPORT_RUNS (500) evict the OLDEST runs; re-saves
// (appendFile) never trigger eviction.

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('reportStore prune-at-cap', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-prune-'));
    process.env.LMDB_PATH = tmpDir;
    jest.resetModules();
    store = require('../../services/lmdb/reportStore.lmdb');
  });

  afterEach(() => {
    require('../../services/lmdb/openEnv').closeEnv();
    jest.resetModules();
    delete process.env.LMDB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = (i) => ({
    runId: `run-${String(i).padStart(5, '0')}`,
    userId: 'u1',
    vertical: 'banking',
    prompt: `q${i}`,
    // Spread far apart so the 5s same-vertical dedup window never collapses
    // consecutive runs, and ISO order matches insertion order.
    startedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
  });

  test('grows freely below the cap', () => {
    for (let i = 0; i < 50; i += 1) store.saveRun(run(i));
    expect(store.listRuns('u1', { limit: 1000 }).length).toBe(50);
  });

  test('the 501st new run evicts the oldest, keeping exactly 500', () => {
    for (let i = 0; i < 501; i += 1) store.saveRun(run(i));
    const kept = store.listRuns('u1', { limit: 1000 });
    expect(kept.length).toBe(500);
    // Oldest gone, newest kept.
    expect(kept.some((r) => r.runId === 'run-00000')).toBe(false);
    expect(kept.some((r) => r.runId === 'run-00500')).toBe(true);
  });

  test('appendFile (re-save) never evicts', () => {
    for (let i = 0; i < 500; i += 1) store.saveRun(run(i));
    store.appendFile('u1', 'run-00000', { name: 'report.pdf' });
    const kept = store.listRuns('u1', { limit: 1000 });
    expect(kept.length).toBe(500);
    expect(kept.some((r) => r.runId === 'run-00000')).toBe(true);
  });
});
