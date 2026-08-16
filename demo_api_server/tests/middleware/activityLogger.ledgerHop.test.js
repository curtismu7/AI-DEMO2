'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));
jest.mock('../../data/store', () => ({
  createActivityLog: jest.fn().mockResolvedValue({}),
}));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { runWithCorrelation } = require('../../utils/correlationContext');
const { logActivity } = require('../../middleware/activityLogger');

function makeReq(overrides = {}) {
  return {
    path: '/api/balance',
    originalUrl: '/api/balance',
    method: 'GET',
    headers: {},
    user: { id: 'u1', username: 'demoUser' },
    get: (name) => (name === 'User-Agent' ? 'jest-agent' : null),
    ip: '127.0.0.1',
    connection: {},
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    send(data) { return data; },
  };
}

describe('activityLogger — backend.request ledger hop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writes a backend.request hop when the request carries an inbound correlation id', () => {
    const req = makeReq({ headers: { 'x-correlation-id': 'c-inbound-1' } });
    const res = makeRes();

    runWithCorrelation('c-inbound-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-inbound-1', expect.objectContaining({
      phase: 'backend.request',
      op: 'GET /api/balance',
      service: 'demo-api-server',
      status: 'ok',
      identity: { sub: 'u1' },
    }));
  });

  test('does NOT write a ledger hop when no inbound correlation id header was present', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();

    runWithCorrelation('c-generated-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('marks the hop status "error" for a >=400 response', () => {
    const req = makeReq({ headers: { 'x-request-id': 'c-err-1' } });
    const res = makeRes();
    res.statusCode = 500;

    runWithCorrelation('c-err-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ error: 'boom' }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-err-1', expect.objectContaining({ status: 'error' }));
  });

  test('skips /health entirely — pre-existing early-return behavior preserved', () => {
    const req = makeReq({ path: '/health', headers: { 'x-correlation-id': 'c-health' } });
    const res = makeRes();
    const next = jest.fn();

    runWithCorrelation('c-health', () => {
      logActivity(req, res, next);
    });

    expect(next).toHaveBeenCalled();
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });
});
