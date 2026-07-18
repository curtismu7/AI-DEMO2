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

function app() {
  const a = express();
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
