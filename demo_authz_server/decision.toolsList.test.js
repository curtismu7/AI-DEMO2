'use strict';

/**
 * McpToolsList per-tool advice — the gateway sends CandidateTools + Vertical and
 * the mock returns PERMIT with advice describing which tools are permitted/denied
 * for the token's scopes, plus the AllowedVertical. Drives the greyed-chip UI.
 *
 * SoT scopes (scope-topology.json): view_records → read, book_appointment → write.
 */
const test = require('node:test');
const assert = require('node:assert');
const decisionHandler = require('./routes/decision');

function mkRes() { return { body: null, json(b) { this.body = b; } }; }
const AUD = process.env.MCP_GATEWAY_RESOURCE_URI || 'mcpgateway.ping.demo';

function baseParams(over = {}) {
  return {
    DecisionContext: 'McpToolsList',
    ClientId: 'demoUser',
    TokenAudience: AUD,
    TokenScopes: 'read',
    Vertical: 'healthcare',
    CandidateTools: JSON.stringify(['view_records', 'book_appointment']),
    ...over,
  };
}

test('McpToolsList returns per-tool advice: read scope permits read tools, denies write tools', async () => {
  const res = mkRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams() } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT');
  const advice = res.body.advice || [];
  const permitted = advice.find(a => a.name === 'PermittedTools')?.value;
  const denied = advice.find(a => a.name === 'DeniedTools')?.value;
  const vertical = advice.find(a => a.name === 'AllowedVertical')?.value;
  assert.deepStrictEqual(JSON.parse(permitted), ['view_records']);
  const deniedParsed = JSON.parse(denied);
  assert.strictEqual(deniedParsed[0].name, 'book_appointment');
  assert.match(deniedParsed[0].reason, /write/);
  assert.strictEqual(vertical, 'healthcare');
});

test('McpToolsList with read+write permits both', async () => {
  const res = mkRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TokenScopes: 'read write' }) } }, res);
  const advice = res.body.advice || [];
  assert.deepStrictEqual(JSON.parse(advice.find(a => a.name === 'DeniedTools').value), []);
});

test('McpToolsList without CandidateTools keeps legacy single-PERMIT', async () => {
  const res = mkRes();
  const p = baseParams();
  delete p.CandidateTools;
  delete p.Vertical;
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: p } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT');
});
