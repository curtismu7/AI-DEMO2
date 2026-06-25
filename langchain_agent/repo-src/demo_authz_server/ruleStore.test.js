'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the overlay file per test run via env, then require a FRESH module.
let OVERLAY;
let ruleStore;

function freshStore() {
  delete require.cache[require.resolve('./ruleStore')];
  ruleStore = require('./ruleStore');
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rules-overlay-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID;
  delete process.env.AGENT_OAUTH_CLIENT_ID;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  freshStore();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('defaults come from env when no overlay exists', () => {
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
  assert.strictEqual(ruleStore.getEnforceMayAct(), true);
  assert.strictEqual(ruleStore.getAuthorizedActorClientId(), '');
  assert.strictEqual(ruleStore.getToolDiscoveryDecision(), 'PERMIT');
});

test('applyPatch overrides a global knob and persists to the overlay file', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 50, toolDiscoveryDecision: 'DENY' } });
  assert.strictEqual(ruleStore.getHitlThreshold(), 50);
  assert.strictEqual(ruleStore.getToolDiscoveryDecision(), 'DENY');
  const onDisk = JSON.parse(fs.readFileSync(OVERLAY, 'utf8'));
  assert.strictEqual(onDisk.global.hitlThresholdUsd, 50);
  assert.strictEqual(onDisk.version, 1);
  assert.ok(onDisk.updatedAt);
});

test('overlay is reloaded from disk on fresh require', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 77 } });
  freshStore();
  assert.strictEqual(ruleStore.getHitlThreshold(), 77);
});

test('per-tool requiredScopes override falls back to SoT for untouched tools', () => {
  ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['read'] } } });
  assert.deepStrictEqual(ruleStore.requiredScopesForTool('create_transfer'), ['read']);
  // an unrelated known tool still uses scope-topology.json
  assert.notStrictEqual(ruleStore.requiredScopesForTool('get_my_accounts'), null);
});

test('isWrite override is honored; default falls back to SoT', () => {
  ruleStore.applyPatch({ tools: { get_my_accounts: { isWrite: true } } });
  assert.strictEqual(ruleStore.isWriteTool('get_my_accounts'), true);
});

test('reset clears the overlay and deletes the file', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 12 } });
  ruleStore.reset();
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
  assert.strictEqual(fs.existsSync(OVERLAY), false);
});

test('applyPatch rejects invalid values and leaves overlay unchanged', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 30 } });
  assert.throws(() => ruleStore.applyPatch({ global: { hitlThresholdUsd: -5 } }), /hitlThresholdUsd/);
  assert.throws(() => ruleStore.applyPatch({ global: { toolDiscoveryDecision: 'MAYBE' } }), /toolDiscoveryDecision/);
  assert.throws(() => ruleStore.applyPatch({ global: { nope: 1 } }), /unknown global key/);
  assert.throws(() => ruleStore.applyPatch({ tools: { not_a_real_tool: { isWrite: true } } }), /unknown tool/);
  assert.throws(() => ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['bogus'] } } }), /requiredScopes/);
  // unchanged
  assert.strictEqual(ruleStore.getHitlThreshold(), 30);
});

test('getEditableBlock reports value/default/overridden', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 99 } });
  const block = ruleStore.getEditableBlock();
  assert.strictEqual(block.global.hitlThresholdUsd.value, 99);
  assert.strictEqual(block.global.hitlThresholdUsd.default, 250);
  assert.strictEqual(block.global.hitlThresholdUsd.overridden, true);
  assert.strictEqual(block.global.enforceMayAct.overridden, false);
  // allowedScopes is derived from scope-topology.json's scopes map (not hardcoded)
  assert.ok(Array.isArray(block.allowedScopes));
  assert.ok(block.allowedScopes.includes('read') && block.allowedScopes.includes('transfer'));
  assert.ok(block.tools.create_transfer, 'gateway tools are listed');
});
