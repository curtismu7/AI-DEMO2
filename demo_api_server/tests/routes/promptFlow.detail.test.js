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

describe('GET /api/prompt-flow/:correlationId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns hops ordered by timestamp with full details per hop', async () => {
    ledger.getRecord.mockReturnValue({
      correlationId: 'c1',
      startedAt: '2026-08-16T00:00:00.000Z',
      endedAt: '2026-08-16T00:00:05.000Z',
      principal: 'u1',
      hops: [
        { phase: 'backend.request', ts: '2026-08-16T00:00:05.000Z', seq: 3, details: { endpoint: 'GET /api/balance' } },
        { phase: 'agent.step', ts: '2026-08-16T00:00:00.000Z', seq: 1, details: { content: 'reasoning...' } },
        { phase: 'llm.call', ts: '2026-08-16T00:00:02.000Z', seq: 2, details: { model: 'llama' } },
      ],
    });

    const res = await request(app()).get('/api/prompt-flow/c1');

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe('c1');
    expect(res.body.principal).toBe('u1');
    expect(res.body.hops.map((h) => h.phase)).toEqual(['agent.step', 'llm.call', 'backend.request']);
    expect(res.body.hops[0].details).toEqual({ content: 'reasoning...' });
  });

  test('returns an empty hops array for an unknown correlationId, not an error', async () => {
    ledger.getRecord.mockReturnValue(null);
    const res = await request(app()).get('/api/prompt-flow/nope');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ correlationId: 'nope', hops: [] });
  });

  test('degrades to an empty hops array on a store read failure', async () => {
    ledger.getRecord.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/prompt-flow/c1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ correlationId: 'c1', hops: [] });
  });
});
