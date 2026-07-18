'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { emitHop, __setFetchForTests } = require('../transactionHop');
const { runWithCorrelation } = require('../correlationContext');

function harness() {
  const calls = [];
  __setFetchForTests(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true };
  });
  process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
  process.env.BFF_INTERNAL_SECRET = 'sekrit';
  return calls;
}

function reset() {
  __setFetchForTests(undefined);
  delete process.env.BFF_TRANSACTION_HOP_URL;
  delete process.env.BFF_INTERNAL_SECRET;
}

test('posts a hop stamped with the ALS correlation id and service name', async () => {
  const calls = harness();
  runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision', op: 'create_transfer' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].body.correlationId, 'c1');
  assert.strictEqual(calls[0].body.service, 'authz-server');
  assert.strictEqual(calls[0].body.phase, 'authz.decision');
  assert.strictEqual(calls[0].headers['x-internal-gateway-secret'], 'sekrit');
  reset();
});

test('no-ops outside a correlation scope', async () => {
  const calls = harness();
  emitHop({ phase: 'authz.decision' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 0);
  reset();
});

test('no-ops when the ingest URL is unset', async () => {
  const calls = harness();
  delete process.env.BFF_TRANSACTION_HOP_URL;
  runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 0);
  reset();
});

test('never throws when the transport rejects', async () => {
  harness();
  __setFetchForTests(async () => { throw new Error('network down'); });
  assert.doesNotThrow(() => runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision' })));
  await new Promise((r) => setImmediate(r));
  reset();
});
