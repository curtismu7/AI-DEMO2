'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  getRecord: jest.fn(),
  listRecords: jest.fn(),
}));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { assemble } = require('../../services/transactionAssembler');
const router = require('../../routes/transactionTrace');

// Defaults to an admin identity so pre-existing tests that aren't about
// ownership (list/limit/degrade/traceId behaviour) keep exercising exactly
// what they did before ownership enforcement was added. Ownership-specific
// tests below pass an explicit non-admin user.
function app(user = { id: 'admin-test', role: 'admin' }) {
  const a = express();
  a.use((req, res, next) => {
    req.user = user;
    next();
  });
  a.use('/api/transaction-trace', router);
  return a;
}

describe('GET /api/transaction-trace', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('lists transactions newest-first', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c2', startedAt: 'B', endedAt: 'B', hopCount: 3 },
      { correlationId: 'c1', startedAt: 'A', endedAt: 'A', hopCount: 6 },
    ]);
    const res = await request(app()).get('/api/transaction-trace');
    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c2', 'c1']);
  });

  test('passes limit through to the store', async () => {
    ledger.listRecords.mockReturnValue([]);
    await request(app()).get('/api/transaction-trace?limit=5');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 5 });
  });

  test('ignores a non-numeric limit', async () => {
    ledger.listRecords.mockReturnValue([]);
    await request(app()).get('/api/transaction-trace?limit=abc');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: undefined });
  });

  test('404 for an unknown correlation id', async () => {
    assemble.mockResolvedValue(null);
    const res = await request(app()).get('/api/transaction-trace/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('returns the record with a derived traceId', async () => {
    assemble.mockResolvedValue({
      correlationId: '3d5b456e-9de9-4091-850b-2d04fd0948b6',
      startedAt: 'A',
      endedAt: 'B',
      hops: [{ seq: 1, phase: 'ui.request', service: 'demo-api-server' }],
    });
    const res = await request(app()).get('/api/transaction-trace/3d5b456e-9de9-4091-850b-2d04fd0948b6');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe('3d5b456e9de94091850b2d04fd0948b6');
    expect(res.body.hops).toHaveLength(1);
  });

  test('degrades to an empty list when the store throws', async () => {
    ledger.listRecords.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/transaction-trace');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transactions: [] });
  });
});

describe('ownership enforcement — GET /api/transaction-trace/:correlationId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('non-admin gets their own record', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: 'user-1',
      hops: [{ seq: 1, phase: 'ui.request', service: 'demo-api-server' }],
    });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe('c1');
  });

  test('non-admin gets 404 (not 403) for another principal\'s record', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: 'other-user', hops: [],
    });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('non-admin gets 404 for a record with an unattributed (unknown) principal', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: null, hops: [],
    });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('admin gets a record owned by another principal', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: 'other-user', hops: [],
    });
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
  });

  test('admin gets a record with an unattributed (unknown) principal', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: null, hops: [],
    });
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
  });
});

describe('ownership enforcement — GET /api/transaction-trace (list)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  const RECORDS = [
    { correlationId: 'c1', startedAt: 'B', endedAt: 'B', hopCount: 1, principal: 'user-1' },
    { correlationId: 'c2', startedAt: 'A', endedAt: 'A', hopCount: 1, principal: 'user-2' },
    { correlationId: 'c3', startedAt: 'C', endedAt: 'C', hopCount: 1, principal: null },
  ];

  test('non-admin sees only their own transactions', async () => {
    ledger.listRecords.mockReturnValue(RECORDS);
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace');
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c1']);
  });

  test('admin sees all transactions, including unattributed ones', async () => {
    ledger.listRecords.mockReturnValue(RECORDS);
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace');
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c1', 'c2', 'c3']);
  });
});
