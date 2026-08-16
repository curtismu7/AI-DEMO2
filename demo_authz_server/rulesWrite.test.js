'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY, putHandler, resetHandler, ruleStore;

function fresh() {
  for (const m of ['./ruleStore', './routes/rulesWrite']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  ruleStore = require('./ruleStore');
  ({ putHandler, resetHandler } = require('./routes/rulesWrite'));
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rw-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  delete process.env.AUTHZ_ADMIN_TOKEN;
  delete process.env.HOST;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});
afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  delete process.env.HOST;
});

test('PUT applies a valid patch and returns the editable block', () => {
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 42 } } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.editable.global.hitlThresholdUsd.value, 42);
  assert.strictEqual(ruleStore.getHitlThreshold(), 42);
});

test('PUT rejects an invalid patch with 400 and leaves state unchanged', () => {
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: -1 } } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /hitlThresholdUsd/);
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
});

test('reset clears overrides', () => {
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 42 } } }, makeRes());
  const res = makeRes();
  resetHandler({ headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
});

test('guard active when AUTHZ_ADMIN_TOKEN set: wrong/missing token -> 401, correct -> 200', () => {
  process.env.AUTHZ_ADMIN_TOKEN = 'sekret';
  fresh();
  const noTok = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 5 } } }, noTok);
  assert.strictEqual(noTok.statusCode, 401);

  const wrong = makeRes();
  putHandler({ headers: { 'x-authz-admin-token': 'nope' }, body: { global: { hitlThresholdUsd: 5 } } }, wrong);
  assert.strictEqual(wrong.statusCode, 401);

  const ok = makeRes();
  putHandler({ headers: { 'x-authz-admin-token': 'sekret' }, body: { global: { hitlThresholdUsd: 5 } } }, ok);
  assert.strictEqual(ok.statusCode, 200);
});

test('no token + loopback HOST (k8s sidecar default): guard stays inactive -> 200', () => {
  process.env.HOST = '127.0.0.1';
  fresh();
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 5 } } }, res);
  assert.strictEqual(res.statusCode, 200);
});

test('no token + non-loopback HOST (docker-compose HOST=0.0.0.0): guard fails closed -> 401', () => {
  process.env.HOST = '0.0.0.0';
  fresh();
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 5 } } }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);

  const resetRes = makeRes();
  resetHandler({ headers: {} }, resetRes);
  assert.strictEqual(resetRes.statusCode, 401);
});
