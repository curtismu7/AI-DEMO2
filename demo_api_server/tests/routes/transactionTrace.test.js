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
    ledger.getRecord.mockReturnValue(null);
    const res = await request(app()).get('/api/transaction-trace/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    // A nonexistent correlationId is rejected off the cheap ledger.getRecord
    // lookup alone — assemble() (and its async token-chain read) never runs.
    expect(assemble).not.toHaveBeenCalled();
  });

  test('500 when ledger.getRecord throws', async () => {
    ledger.getRecord.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(assemble).not.toHaveBeenCalled();
  });

  test('500 when assemble throws after ownership passes', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: null });
    assemble.mockRejectedValue(new Error('boom'));
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
  });

  test('returns the record with a derived traceId', async () => {
    ledger.getRecord.mockReturnValue({
      correlationId: '3d5b456e-9de9-4091-850b-2d04fd0948b6',
      principal: null,
    });
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

  test('attaches a verdict computed from the assembled hops', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1',
      startedAt: 'A',
      endedAt: 'B',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'authz-server', phase: 'authz.decision', op: 'x', decision: { outcome: 'deny', by: 'mock', reason: 'nope' } },
        { seq: 2, ts: '2026-07-18T00:00:01.000Z', service: 'mcp-server', phase: 'mcp.tool', op: 'x' },
      ],
    });
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.body.verdict.status).toBe('FAIL');
    expect(res.body.verdict.violations.map((v) => v.id)).toContain('INV-6');
  });
});

describe('ownership enforcement — GET /api/transaction-trace/:correlationId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('non-admin gets their own record', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: 'user-1' });
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: 'user-1',
      hops: [{ seq: 1, phase: 'ui.request', service: 'demo-api-server' }],
    });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe('c1');
    expect(assemble).toHaveBeenCalledWith('c1');
  });

  test('non-admin gets 404 (not 403) for another principal\'s record, and never reaches the derived-token read', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: 'other-user' });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    // The regression this guards against: assemble() (and inside it,
    // tokenChainService.getTokenChain) must never run for a rejected
    // ownership check — only ledger.getRecord (cheap, sync) may. If the
    // route went back to calling assemble() before checking ownership, this
    // assertion is what would catch it — the response body/status alone
    // can't, since both 404s look identical.
    expect(assemble).not.toHaveBeenCalled();
  });

  test('non-admin gets 404 for a record with an unattributed (unknown) principal, and never reaches the derived-token read', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: null });
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(assemble).not.toHaveBeenCalled();
  });

  test('admin gets a record owned by another principal', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: 'other-user' });
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: 'other-user', hops: [],
    });
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
    expect(assemble).toHaveBeenCalledWith('c1');
  });

  test('admin gets a record with an unattributed (unknown) principal', async () => {
    ledger.getRecord.mockReturnValue({ correlationId: 'c1', principal: null });
    assemble.mockResolvedValue({
      correlationId: 'c1', startedAt: 'A', endedAt: 'B', principal: null, hops: [],
    });
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace/c1');
    expect(res.status).toBe(200);
    expect(assemble).toHaveBeenCalledWith('c1');
  });

  test('the 404 for "not yours" is byte-identical (status + body) to the 404 for "nonexistent"', async () => {
    ledger.getRecord.mockReturnValueOnce({ correlationId: 'c1', principal: 'other-user' });
    const notYours = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c1');

    ledger.getRecord.mockReturnValueOnce(null);
    const nonexistent = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace/c2');

    expect(notYours.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(notYours.status).toBe(nonexistent.status);
    expect(notYours.body).toEqual({ error: 'not_found' });
    expect(notYours.body).toEqual(nonexistent.body);
    expect(assemble).not.toHaveBeenCalled();
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
    // The store, not the route, does the filtering (Fix 2: filter before
    // limit) — so the mock returns what a real principal-scoped listRecords
    // call would. The call-args assertion below is what proves the route
    // pushed `principal` into the store call instead of filtering the
    // already-limited page itself.
    ledger.listRecords.mockReturnValue(RECORDS.filter((r) => r.principal === 'user-1'));
    const res = await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: undefined, principal: 'user-1' });
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c1']);
  });

  test('admin sees all transactions, including unattributed ones', async () => {
    ledger.listRecords.mockReturnValue(RECORDS);
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: undefined });
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c1', 'c2', 'c3']);
  });

  test('admin limit still applies when passed alongside the unfiltered listing', async () => {
    ledger.listRecords.mockReturnValue(RECORDS.slice(0, 2));
    const res = await request(app({ id: 'admin-1', role: 'admin' })).get('/api/transaction-trace?limit=2');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 2 });
    expect(res.body.transactions).toHaveLength(2);
  });

  test('non-admin limit is pushed through alongside the principal filter', async () => {
    ledger.listRecords.mockReturnValue(RECORDS.filter((r) => r.principal === 'user-1'));
    await request(app({ id: 'user-1', role: 'customer' })).get('/api/transaction-trace?limit=2');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 2, principal: 'user-1' });
  });
});
