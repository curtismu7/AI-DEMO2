'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY, rulesHandler, ruleStore;

function fresh() {
  for (const m of ['./ruleStore', './routes/rules']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  ruleStore = require('./ruleStore');
  rulesHandler = require('./routes/rules');
}

function makeRes() { return { body: null, json(b) { this.body = b; return this; } }; }

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rules-route-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});
afterEach(() => { try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ } });

test('GET /rules includes an editable block and reflects the live threshold', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 60 } });
  const res = makeRes();
  rulesHandler({}, res);
  assert.ok(Array.isArray(res.body.rules));
  assert.ok(res.body.editable, 'editable block present');
  assert.strictEqual(res.body.editable.global.hitlThresholdUsd.value, 60);
  const hitlRule = res.body.rules.find((r) => r.id === 'hitl-gate');
  assert.strictEqual(hitlRule.config.thresholdUsd, 60);
});
