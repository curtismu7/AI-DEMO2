'use strict';

jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));

const express = require('express');
const request = require('supertest');
const { assemble } = require('../../services/transactionAssembler');
const configStore = require('../../services/configStore');
const router = require('../../routes/transactionTraceEmbed');

function app() {
  const a = express();
  a.use('/api/transaction-trace/embed', router);
  return a;
}

const RECORD = {
  correlationId: 'cid-1',
  startedAt: '2026-08-24T22:00:00.000Z',
  endedAt: '2026-08-24T22:00:01.000Z',
  principal: 'user-1',
  hops: [{ seq: 1, phase: 'ui.request', service: 'mcp-facade' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getEffective.mockReturnValue('true');
});

describe('GET /api/transaction-trace/embed/:correlationId', () => {
  test('404 while no hop has landed yet', async () => {
    assemble.mockResolvedValue(null);
    const res = await request(app()).get('/api/transaction-trace/embed/cid-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('returns the assembled hops with no auth and no-store', async () => {
    assemble.mockResolvedValue(RECORD);
    const res = await request(app()).get('/api/transaction-trace/embed/cid-1');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      correlationId: 'cid-1', startedAt: RECORD.startedAt, endedAt: RECORD.endedAt, hops: RECORD.hops,
    });
    expect(assemble).toHaveBeenCalledWith('cid-1');
  });

  test('403 when the ledger feature flag is off', async () => {
    configStore.getEffective.mockReturnValue('false');
    const res = await request(app()).get('/api/transaction-trace/embed/cid-1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'feature_disabled' });
    expect(assemble).not.toHaveBeenCalled();
  });
});
