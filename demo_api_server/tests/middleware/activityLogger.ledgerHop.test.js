'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));
jest.mock('../../data/store', () => ({
  createActivityLog: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => 'true'),
}));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const configStore = require('../../services/configStore');
const dataStore = require('../../data/store');
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
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockReturnValue('true');
  });

  test('writes a backend.request hop even with no inbound correlation-id header (a correlationId is minted for every request)', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();

    runWithCorrelation('c-generated-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-generated-1', expect.objectContaining({
      phase: 'backend.request',
      op: 'GET /api/balance',
      service: 'demo-api-server',
      status: 'ok',
      identity: { sub: 'u1' },
    }));
  });

  test('writes a backend.request hop when the request carries an inbound correlation id too', () => {
    const req = makeReq({ headers: { 'x-correlation-id': 'c-inbound-1' } });
    const res = makeRes();

    runWithCorrelation('c-inbound-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-inbound-1', expect.objectContaining({
      phase: 'backend.request',
      op: 'GET /api/balance',
      status: 'ok',
      identity: { sub: 'u1' },
    }));
  });

  test('does NOT write a ledger hop for a denylisted polling route, even with an inbound header', () => {
    const req = makeReq({
      path: '/api/auth/session',
      originalUrl: '/api/auth/session',
      headers: { 'x-correlation-id': 'c-poll-1' },
    });
    const res = makeRes();

    runWithCorrelation('c-poll-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('does NOT write a ledger hop when ff_transaction_ledger is off', () => {
    configStore.getEffective.mockReturnValue('false');
    const req = makeReq();
    const res = makeRes();

    runWithCorrelation('c-flag-off', () => {
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

  test('strips the query string from op', () => {
    const req = makeReq({
      originalUrl: '/api/balance?accountId=123&secretToken=abc',
      path: '/api/balance',
    });
    const res = makeRes();

    runWithCorrelation('c-query-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-query-1', expect.objectContaining({
      op: 'GET /api/balance',
    }));
  });

  test('resolves identity.sub via resolveActingIdentity (session id preferred over req.user.id)', () => {
    const req = makeReq({
      user: { id: 'pingone-uuid-1', username: 'demoUser' },
      session: { user: { id: '5', username: 'demoUser' } },
    });
    const res = makeRes();

    runWithCorrelation('c-identity-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-identity-1', expect.objectContaining({
      identity: { sub: '5' },
    }));
  });

  test('redacts requestBody before writing it into the hop', () => {
    const req = makeReq({
      method: 'POST',
      originalUrl: '/api/transfer',
      path: '/api/transfer',
      body: { amount: 100, apiKey: 'super-secret-key' },
    });
    const res = makeRes();

    runWithCorrelation('c-redact-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    const call = ledger.appendHop.mock.calls.find((c) => c[0] === 'c-redact-1');
    expect(call[1].details.requestBody.apiKey).toBe('[REDACTED]');
    expect(call[1].details.requestBody.amount).toBe(100);
  });

  test('a hop-emission failure does not suppress the activity log write', () => {
    ledger.appendHop.mockImplementation(() => { throw new Error('ledger down'); });
    const req = makeReq();
    const res = makeRes();

    runWithCorrelation('c-fail-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(dataStore.createActivityLog).toHaveBeenCalledTimes(1);
  });
});
