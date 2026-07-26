'use strict';

jest.mock('../../services/lmdb/openEnv', () => {
  const dbs = new Map();
  function openDB(name) {
    if (!dbs.has(name)) dbs.set(name, new Map());
    const m = dbs.get(name);
    return {
      get(key) { return m.has(key) ? m.get(key) : undefined; },
      putSync(key, value) { m.set(key, value); },
      removeSync(key) { m.delete(key); },
      getKeys() { return [...m.keys()]; },
      getStats() { return { entryCount: m.size }; },
      getRange({ reverse } = {}) {
        const out = [...m.entries()].map(([key, value]) => ({ key, value }));
        return reverse ? out.reverse() : out;
      },
    };
  }
  return {
    openEnv: () => ({ openDB }),
    getDb: (name) => openDB(name),
    LMDB_PATH: '/tmp/fake',
    __reset: () => dbs.clear(),
  };
});

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const openEnvMock = require('../../services/lmdb/openEnv');

describe('transactionLedger', () => {
  beforeEach(() => { openEnvMock.__reset(); });

  test('getRecord returns null for an unknown correlation id', () => {
    expect(ledger.getRecord('nope')).toBeNull();
  });

  test('appendHop creates a record and assigns seq 1', () => {
    const rec = ledger.appendHop('c1', { service: 'demo-api-server', phase: 'ui.request' });
    expect(rec.correlationId).toBe('c1');
    expect(rec.hops).toHaveLength(1);
    expect(rec.hops[0].seq).toBe(1);
    expect(rec.hops[0].phase).toBe('ui.request');
    expect(typeof rec.hops[0].ts).toBe('string');
  });

  test('hops accumulate in arrival order with increasing seq', () => {
    ledger.appendHop('c1', { service: 'demo-api-server', phase: 'ui.request' });
    ledger.appendHop('c1', { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' });
    const rec = ledger.getRecord('c1');
    expect(rec.hops.map((h) => h.seq)).toEqual([1, 2]);
    expect(rec.hops.map((h) => h.phase)).toEqual(['ui.request', 'mcp.tool']);
  });

  test('a caller-supplied ts is preserved', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'mcp.tool', ts: '2026-07-18T00:00:00.000Z' });
    expect(ledger.getRecord('c1').hops[0].ts).toBe('2026-07-18T00:00:00.000Z');
  });

  test('endedAt advances as hops arrive but startedAt does not', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    const first = ledger.getRecord('c1');
    ledger.appendHop('c1', { service: 'y', phase: 'response' });
    const second = ledger.getRecord('c1');
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.endedAt >= first.endedAt).toBe(true);
  });

  test('listRecords returns newest-first summaries', () => {
    ledger.appendHop('older', { service: 'x', phase: 'ui.request', ts: '2026-07-18T00:00:00.000Z' });
    ledger.appendHop('newer', { service: 'x', phase: 'ui.request', ts: '2026-07-18T01:00:00.000Z' });
    const list = ledger.listRecords();
    expect(list.map((r) => r.correlationId)).toEqual(['newer', 'older']);
    expect(list[0].hopCount).toBe(1);
  });

  test('listRecords honours limit', () => {
    for (let i = 0; i < 5; i++) ledger.appendHop(`c${i}`, { service: 'x', phase: 'ui.request' });
    expect(ledger.listRecords({ limit: 2 })).toHaveLength(2);
  });

  test('evicts the oldest transactions past MAX_TRANSACTIONS', () => {
    for (let i = 0; i < ledger.MAX_TRANSACTIONS + 3; i++) {
      ledger.appendHop(`c${String(i).padStart(4, '0')}`, {
        service: 'x',
        phase: 'ui.request',
        ts: `2026-07-18T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
      });
    }
    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
    expect(ledger.getRecord('c0000')).toBeNull();
  });

  test('appending to an existing transaction does not trigger eviction', () => {
    for (let i = 0; i < ledger.MAX_TRANSACTIONS; i++) ledger.appendHop(`c${i}`, { service: 'x', phase: 'ui.request' });
    ledger.appendHop('c0', { service: 'x', phase: 'response' });
    expect(ledger.getRecord('c0').hops).toHaveLength(2);
    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
  });

  test('principal is set from the first hop carrying identity.sub', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request', identity: { sub: 'user-1' } });
    expect(ledger.getRecord('c1').principal).toBe('user-1');
  });

  test('principal is NOT overwritten by a later hop with a different sub', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request', identity: { sub: 'user-1' } });
    ledger.appendHop('c1', { service: 'y', phase: 'mcp.tool', identity: { sub: 'user-2' } });
    expect(ledger.getRecord('c1').principal).toBe('user-1');
  });

  test('a record whose hops never carry a sub has a null principal', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    ledger.appendHop('c1', { service: 'y', phase: 'response', identity: {} });
    expect(ledger.getRecord('c1').principal).toBeNull();
  });

  test('a later hop can set principal when no earlier hop carried a sub', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    ledger.appendHop('c1', { service: 'y', phase: 'mcp.tool', identity: { sub: 'user-1' } });
    expect(ledger.getRecord('c1').principal).toBe('user-1');
  });

  test('listRecords includes principal in the summary', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request', identity: { sub: 'user-1' } });
    ledger.appendHop('c2', { service: 'x', phase: 'ui.request' });
    const list = ledger.listRecords();
    const byId = Object.fromEntries(list.map((r) => [r.correlationId, r.principal]));
    expect(byId.c1).toBe('user-1');
    expect(byId.c2).toBeNull();
  });

  test('listRecords with a principal filter excludes other principals and unattributed records', () => {
    ledger.appendHop('mine', { service: 'x', phase: 'ui.request', identity: { sub: 'user-1' } });
    ledger.appendHop('theirs', { service: 'x', phase: 'ui.request', identity: { sub: 'user-2' } });
    ledger.appendHop('nobody', { service: 'x', phase: 'ui.request' });
    const list = ledger.listRecords({ principal: 'user-1' });
    expect(list.map((r) => r.correlationId)).toEqual(['mine']);
  });

  test('listRecords applies the principal filter BEFORE the limit — a naive filter-after-slice would undercount', () => {
    const ts = (i) => `2026-07-18T00:00:${String(i).padStart(2, '0')}.000Z`;
    // The 5 newest records overall all belong to user-2; user-1 has 5 older
    // records. A naive `listRecords({ limit }).filter(own)` would take the
    // newest 3 (all user-2) and filter user-1 down to nothing, even though
    // user-1 has 5 records in the store.
    for (let i = 0; i < 5; i++) {
      ledger.appendHop(`u1-${i}`, { service: 'x', phase: 'ui.request', ts: ts(i), identity: { sub: 'user-1' } });
    }
    for (let i = 5; i < 10; i++) {
      ledger.appendHop(`u2-${i}`, { service: 'x', phase: 'ui.request', ts: ts(i), identity: { sub: 'user-2' } });
    }

    const naive = ledger.listRecords({ limit: 3 }).filter((r) => r.principal === 'user-1');
    expect(naive).toHaveLength(0);

    const correct = ledger.listRecords({ principal: 'user-1', limit: 3 });
    expect(correct).toHaveLength(3);
    expect(correct.every((r) => r.principal === 'user-1')).toBe(true);
    expect(correct.map((r) => r.correlationId)).toEqual(['u1-4', 'u1-3', 'u1-2']);
  });

  test('clear wipes the store', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    ledger.clear();
    expect(ledger.getRecord('c1')).toBeNull();
    expect(ledger.listRecords()).toEqual([]);
  });

  test('a stale first-hop ts does not make a brand-new record preferentially evictable', () => {
    // Fill the store to capacity with genuinely-old-by-insertion records.
    for (let i = 0; i < ledger.MAX_TRANSACTIONS; i++) {
      ledger.appendHop(`c${String(i).padStart(4, '0')}`, { service: 'x', phase: 'ui.request' });
    }
    // A brand-new transaction whose first hop carries a very old (e.g. replayed)
    // ts. Eviction must go by real insertion order, not this spoofable value.
    ledger.appendHop('stale-ts', {
      service: 'x',
      phase: 'ui.request',
      ts: '1999-01-01T00:00:00.000Z',
    });

    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
    expect(ledger.getRecord('stale-ts')).not.toBeNull();
    expect(ledger.getRecord('c0000')).toBeNull(); // actually-oldest-inserted record is evicted instead
  });

  test('pre-existing records lacking _insertedAt still evict by startedAt fallback', () => {
    const db = openEnvMock.getDb(ledger.DB_NAME);
    // Simulate data written before _insertedAt existed: no _insertedAt field.
    db.putSync('legacy-oldest', {
      correlationId: 'legacy-oldest',
      startedAt: '2020-01-01T00:00:00.000Z',
      endedAt: '2020-01-01T00:00:00.000Z',
      hops: [{ service: 'x', phase: 'ui.request', seq: 1, ts: '2020-01-01T00:00:00.000Z' }],
    });
    for (let i = 0; i < ledger.MAX_TRANSACTIONS; i++) {
      ledger.appendHop(`c${String(i).padStart(4, '0')}`, { service: 'x', phase: 'ui.request' });
    }

    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
    expect(ledger.getRecord('legacy-oldest')).toBeNull();
  });

  test('endedAt is never earlier than startedAt, even when a later hop carries an earlier ts', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request', ts: '2026-07-18T12:00:00.000Z' });
    const rec = ledger.appendHop('c1', {
      service: 'y',
      phase: 'response',
      ts: '2026-07-18T01:00:00.000Z', // earlier than the first hop's ts
    });

    expect(rec.startedAt).toBe('2026-07-18T12:00:00.000Z');
    expect(new Date(rec.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(rec.startedAt).getTime());
  });

  test('an unparseable ts does not corrupt startedAt/endedAt ordering', () => {
    const rec = ledger.appendHop('bad-ts', { service: 'x', phase: 'ui.request', ts: 'not-a-timestamp' });

    expect(Number.isNaN(new Date(rec.startedAt).getTime())).toBe(false);
    expect(Number.isNaN(new Date(rec.endedAt).getTime())).toBe(false);
    expect(new Date(rec.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(rec.startedAt).getTime());

    const second = ledger.appendHop('bad-ts', { service: 'y', phase: 'response', ts: 'also-garbage' });
    expect(new Date(second.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(second.startedAt).getTime());
  });
});
