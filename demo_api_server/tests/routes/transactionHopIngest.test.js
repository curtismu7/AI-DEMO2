'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const router = require('../../routes/transactionHopIngest');

const SECRET = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';

function app() {
  const a = express();
  a.use('/internal', router);
  return a;
}

const VALID = {
  correlationId: 'c1',
  service: 'mcp-server',
  phase: 'mcp.tool',
  op: 'get_balance',
};

describe('POST /internal/transaction-hop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('403 without the internal secret', async () => {
    const res = await request(app()).post('/internal/transaction-hop').send(VALID);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('403 with a wrong secret', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', 'nope')
      .send(VALID);
    expect(res.status).toBe(403);
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('204 and persists a valid hop', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send(VALID);
    expect(res.status).toBe(204);
    expect(ledger.appendHop).toHaveBeenCalledWith('c1', expect.objectContaining({
      service: 'mcp-server',
      phase: 'mcp.tool',
      op: 'get_balance',
    }));
  });

  test('400 when correlationId is missing', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({ service: 'x', phase: 'mcp.tool' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_hop' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('400 on an unknown phase', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({ correlationId: 'c1', service: 'x', phase: 'not.a.phase' });
    expect(res.status).toBe(400);
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('strips raw token fields before persisting', async () => {
    await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({
        ...VALID,
        identity: { sub: 'u1', jti: 'j1', access_token: 'eyJraw', subject_token: 'eyJraw2' },
      });
    const [, hop] = ledger.appendHop.mock.calls[0];
    expect(hop.identity.sub).toBe('u1');
    expect(hop.identity.jti).toBe('j1');
    expect(hop.identity.access_token).toBeUndefined();
    expect(hop.identity.subject_token).toBeUndefined();
  });

  test('204 even when the store throws — auditing never breaks the caller', async () => {
    ledger.appendHop.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send(VALID);
    expect(res.status).toBe(204);
  });
});
