'use strict';
const { emitHop, __setFetchForTests } = require('../src/transactionHop');
const { runWithCorrelation } = require('../src/correlationContext');

describe('hitl emitHop', () => {
  const calls = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 'sekrit';
    __setFetchForTests(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true };
    });
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  test('posts a hop stamped with the ALS correlation id and service name', async () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'hitl.consent', op: 'create_transfer' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ correlationId: 'c1', service: 'hitl-service', phase: 'hitl.consent' });
    expect(calls[0].headers['x-internal-gateway-secret']).toBe('sekrit');
  });

  test('an explicit correlationId wins over the ALS value', async () => {
    runWithCorrelation('c-als', () => emitHop({ phase: 'hitl.consent', correlationId: 'c-explicit' }));
    await new Promise((r) => setImmediate(r));
    expect(calls[0].body.correlationId).toBe('c-explicit');
  });

  test('no-ops outside a correlation scope', async () => {
    emitHop({ phase: 'hitl.consent' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  test('never throws when the transport rejects', async () => {
    __setFetchForTests(async () => { throw new Error('network down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'hitl.consent' }))).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
