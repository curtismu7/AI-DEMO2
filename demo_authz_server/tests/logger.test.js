'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { auditDecision } = require('../logger');
const { runWithCorrelation, setDecisionContext } = require('../correlationContext');

test('auditDecision returns the full record it logs, including scopes/RAR/intent/HITL/decisionId/policyVersion', () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  let record;
  try {
    runWithCorrelation('cid-audit-1', () => {
      setDecisionContext({
        decisionContext: 'McpToolCall',
        tool: 'create_transfer',
        sub: 'user-alice',
        actor: 'agent-1',
        workerId: 'p',
        scopes: ['write', 'transfer'],
        rarPresent: true,
        intentValid: 'true',
        intentMatch: 'true',
        hitlApproved: true,
      });
      record = auditDecision('PERMIT', 'all policy rules passed', { decisionId: 'dec-1', policyVersion: 'mock-v1' });
    });
  } finally {
    console.log = orig;
  }

  assert.strictEqual(record.decision, 'PERMIT');
  assert.strictEqual(record.reason, 'all policy rules passed');
  assert.strictEqual(record.correlationId, 'cid-audit-1');
  assert.strictEqual(record.tool, 'create_transfer');
  assert.strictEqual(record.sub, 'user-alice');
  assert.strictEqual(record.actor, 'agent-1');
  assert.strictEqual(record.workerId, 'p');
  assert.deepStrictEqual(record.scopes, ['write', 'transfer']);
  assert.strictEqual(record.rarPresent, true);
  assert.strictEqual(record.intentValid, 'true');
  assert.strictEqual(record.intentMatch, 'true');
  assert.strictEqual(record.hitlApproved, true);
  assert.strictEqual(record.decisionId, 'dec-1');
  assert.strictEqual(record.policyVersion, 'mock-v1');

  const auditLine = lines.find((l) => l.includes('"evt":"authz_decision"'));
  assert.ok(auditLine, 'expected a structured authz_decision audit line');
  assert.deepStrictEqual(JSON.parse(auditLine), record, 'the logged JSON must match the returned record exactly');
});

test('auditDecision defaults absent context/extra fields to null/empty, never throws', () => {
  let record;
  const orig = console.log;
  console.log = () => {};
  try {
    runWithCorrelation('cid-audit-2', () => {
      record = auditDecision('DENY', 'missing_sub: token must carry a non-empty sub claim');
    });
  } finally {
    console.log = orig;
  }
  assert.strictEqual(record.decision, 'DENY');
  assert.strictEqual(record.tool, null);
  assert.deepStrictEqual(record.scopes, []);
  assert.strictEqual(record.rarPresent, false);
  assert.strictEqual(record.intentValid, null);
  assert.strictEqual(record.intentMatch, null);
  assert.strictEqual(record.hitlApproved, false);
  assert.strictEqual(record.decisionId, null);
  assert.strictEqual(record.policyVersion, null);
});
