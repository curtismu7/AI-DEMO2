'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  listRecords: jest.fn(),
  getRecord: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const promptFlowRouter = require('../../routes/promptFlow');

function app() {
  const a = express();
  a.use('/api/prompt-flow', promptFlowRouter);
  return a;
}

describe('GET /api/prompt-flow', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns one summary per correlationId with status/vertical derived from hops', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: '2026-08-16T00:00:00.000Z', endedAt: '2026-08-16T00:00:01.000Z', hopCount: 2, principal: 'u1' },
      { correlationId: 'c2', startedAt: '2026-08-16T00:01:00.000Z', endedAt: '2026-08-16T00:01:01.000Z', hopCount: 1, principal: null },
    ]);
    ledger.getRecord.mockImplementation((id) => {
      if (id === 'c1') {
        return { hops: [
          { phase: 'agent.step', status: 'ok', details: { vertical: 'sporting-goods' } },
          { phase: 'backend.request', status: 'ok' },
        ] };
      }
      if (id === 'c2') {
        return { hops: [{ phase: 'gateway.authorize', status: 'error' }] };
      }
      return null;
    });

    const res = await request(app()).get('/api/prompt-flow');

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([
      expect.objectContaining({ correlationId: 'c1', status: 'ok', vertical: 'sporting-goods' }),
      expect.objectContaining({ correlationId: 'c2', status: 'error', vertical: null }),
    ]);
  });

  test('marks a run "error" when a P1AZ hop is status "ok" but decision.outcome is "deny"', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: 't1', endedAt: 't1', hopCount: 1, principal: 'u1' },
    ]);
    ledger.getRecord.mockReturnValue({
      hops: [
        { phase: 'authz.decision', status: 'ok', decision: { outcome: 'deny', by: 'mock' } },
      ],
    });

    const res = await request(app()).get('/api/prompt-flow');

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([
      expect.objectContaining({ correlationId: 'c1', status: 'error' }),
    ]);
  });

  test('a "permit" decision outcome does not flip an otherwise-ok run to error', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: 't1', endedAt: 't1', hopCount: 1, principal: 'u1' },
    ]);
    ledger.getRecord.mockReturnValue({
      hops: [
        { phase: 'authz.decision', status: 'ok', decision: { outcome: 'permit', by: 'mock' } },
      ],
    });

    const res = await request(app()).get('/api/prompt-flow');

    expect(res.body.runs).toEqual([
      expect.objectContaining({ correlationId: 'c1', status: 'ok' }),
    ]);
  });

  test('applies limit and offset for pagination', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: 't1', endedAt: 't1', hopCount: 1, principal: null },
      { correlationId: 'c2', startedAt: 't2', endedAt: 't2', hopCount: 1, principal: null },
      { correlationId: 'c3', startedAt: 't3', endedAt: 't3', hopCount: 1, principal: null },
    ]);
    ledger.getRecord.mockReturnValue({ hops: [] });

    const res = await request(app()).get('/api/prompt-flow?limit=1&offset=1');

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].correlationId).toBe('c2');
    expect(res.body.limit).toBe(1);
    expect(res.body.offset).toBe(1);
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 2 });
  });

  test('defaults to limit 50 / offset 0 when no query params are given', async () => {
    ledger.listRecords.mockReturnValue([]);
    const res = await request(app()).get('/api/prompt-flow');
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 50 });
  });

  test('degrades to an empty list on a store read failure', async () => {
    ledger.listRecords.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/prompt-flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
  });
});
