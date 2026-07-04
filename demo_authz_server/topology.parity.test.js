'use strict';

/*
 * topology.parity.test.js — the mock PingOne Authorize rule store and its
 * scopeTopology accessor must stay DERIVED from scope-topology.json (the SSOT).
 *
 * ruleStore.js and scopeTopology.js read the manifest today, so these guards are
 * regression tripwires: if a future refactor hardcodes a scope list or a gateway
 * tool list here, the editable policy the demo enforces would silently diverge
 * from the manifest that provisions PingOne and drives the cloud P1AZ snapshot.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

// Isolate from any developer rules-overlay.json so we assert FACTORY defaults,
// not a locally-edited overlay. Point at a path that does not exist.
process.env.AUTHZ_RULES_OVERLAY_PATH = path.join(os.tmpdir(), 'authz-parity-no-such-overlay.json');

const manifest = require('../scope-topology.json');
const scopeTopology = require('./scopeTopology');
const ruleStore = require('./ruleStore');

const manifestScopes = () => Object.keys(manifest.scopes).sort();
const manifestGatewayTools = () =>
  Object.keys(manifest.tools)
    .filter((n) => manifest.tools[n].surface === 'gateway')
    .sort();

test('scopeTopology.allowedScopes() == manifest scopes{}', () => {
  assert.deepStrictEqual(scopeTopology.allowedScopes().slice().sort(), manifestScopes());
});

test('scopeTopology.gatewayToolNames() == manifest surface:gateway tools', () => {
  assert.deepStrictEqual(scopeTopology.gatewayToolNames().slice().sort(), manifestGatewayTools());
});

test('ruleStore editable allowedScopes == manifest scopes{}', () => {
  const block = ruleStore.getEditableBlock();
  assert.deepStrictEqual(block.allowedScopes.slice().sort(), manifestScopes());
});

test('ruleStore editable tool set == manifest surface:gateway tools', () => {
  const block = ruleStore.getEditableBlock();
  assert.deepStrictEqual(Object.keys(block.tools).sort(), manifestGatewayTools());
});

test('each editable tool default requiredScopes == manifest requiredScopes', () => {
  const block = ruleStore.getEditableBlock();
  for (const [name, t] of Object.entries(block.tools)) {
    assert.deepStrictEqual(
      t.requiredScopes.default,
      manifest.tools[name].requiredScopes,
      `tool ${name}: rule-store default requiredScopes drifted from the manifest`
    );
  }
});
