'use strict';

/**
 * importSnapshot.parity.test.js — F9: snapshot parity must BLOCK the import.
 *
 * Two defects this suite pins:
 *
 *  1. Parity failures were advisory. `import-snapshot.js` detected a consent-tool
 *     mismatch between the snapshot and scope-topology.json and returned HTTP 200
 *     with `valid:false`, so an automated caller could import a snapshot that
 *     silently un-gates tools. The documented instance is the
 *     `…snapshot.FIXED.json` variant, which drops three tools from the
 *     RequiresHitlConsent condition (sensitive_holdings,
 *     sensitive_student_finance, sensitive_supplier_contract). That file is not
 *     tracked in this repo, so the fixture below reproduces it faithfully by
 *     removing exactly those three tool comparisons from the real snapshot.
 *
 *  2. Shared-statement validation only covered ONE hardcoded statement id (the
 *     step-up one). `mcp-authorization-denied` is shared and multi-parented
 *     across seven rules but was never validated. The check is now derived:
 *     ANY statement referenced by more than one rule must be `shared:true`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const importSnapshot = require('./routes/import-snapshot');

const SNAPSHOT_PATH = path.join(
  __dirname,
  '..',
  'snapshots',
  'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json',
);

// Tools the .FIXED.json variant drops from the consent condition.
const DROPPED_BY_FIXED = [
  'sensitive_holdings',
  'sensitive_student_finance',
  'sensitive_supplier_contract',
];

const STEP_UP_STATEMENT_ID = '34567890-0003-4321-abcd-000000000003';
const MCP_DENIED_STATEMENT_ID = '34567890-0004-4321-abcd-000000000004';

function loadSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

function makeReq(snapshotObj) {
  return { file: { buffer: Buffer.from(JSON.stringify(snapshotObj), 'utf8') } };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function validate(snapshotObj) {
  const res = makeRes();
  await importSnapshot(makeReq(snapshotObj), res);
  return res;
}

/** Remove the given tool names from a named condition's `or` comparison list. */
function dropToolsFromCondition(snapshot, conditionName, toolNames) {
  const cond = snapshot.find((o) => o.type === 'CONDITION' && o.name === conditionName);
  assert.ok(cond, `fixture precondition: condition ${conditionName} exists in the snapshot`);
  const prune = (node) => {
    if (node.or && Array.isArray(node.or.conditions)) {
      node.or.conditions = node.or.conditions.filter((c) => {
        const v = c?.comparison?.right?.constant?.value;
        return !toolNames.includes(v);
      });
      node.or.conditions.forEach(prune);
    }
    if (node.and && Array.isArray(node.and.conditions)) node.and.conditions.forEach(prune);
  };
  prune(cond.condition);
  return snapshot;
}

// ── Happy path — the tracked snapshot must still import cleanly ──────────────

test('the tracked SoT snapshot validates clean: HTTP 200, valid:true, no conflicts', async () => {
  const res = await validate(loadSnapshot());
  assert.strictEqual(res.statusCode, 200, `conflicts: ${JSON.stringify(res.body?.conflicts)}`);
  assert.strictEqual(res.body.valid, true);
  assert.deepStrictEqual(res.body.conflicts, []);
});

// ── F9 item 1 — parity failure blocks ───────────────────────────────────────

test('FIXED-style snapshot dropping 3 consent tools is BLOCKED (non-2xx), not merely reported', async () => {
  const snapshot = dropToolsFromCondition(loadSnapshot(), 'RequiresHitlConsent', DROPPED_BY_FIXED);
  const res = await validate(snapshot);

  // The whole point of the fix: an importer cannot treat this as success.
  assert.strictEqual(res.statusCode, 409, 'parity failure must block the import with a non-2xx status');
  assert.strictEqual(res.body.valid, false);

  const conflict = res.body.conflicts.find((c) => c.type === 'consent_tool_mismatch');
  assert.ok(conflict, `expected consent_tool_mismatch, got ${JSON.stringify(res.body.conflicts)}`);

  // It must catch exactly the three tools the FIXED file un-gates.
  for (const tool of DROPPED_BY_FIXED) {
    assert.ok(
      conflict.sot.includes(tool),
      `SoT consent list should still gate ${tool}`,
    );
    assert.ok(
      !conflict.snapshot.includes(tool),
      `snapshot should have dropped ${tool} — that is the un-gating this test pins`,
    );
  }
});

test('step-up tool mismatch also blocks', async () => {
  const snapshot = dropToolsFromCondition(loadSnapshot(), 'RequiresMcpStepUp', ['create_withdrawal']);
  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(res.body.conflicts.some((c) => c.type === 'step_up_tool_mismatch'));
});

// ── F9 item 2 — generalized shared-statement validation ─────────────────────

test('multi-parented mcp-authorization-denied with shared:false is caught (was never validated)', async () => {
  const snapshot = loadSnapshot();
  const stmt = snapshot.find((o) => o.type === 'Statement' && o.id === MCP_DENIED_STATEMENT_ID);
  assert.ok(stmt, 'fixture precondition: mcp-authorization-denied statement exists');
  assert.strictEqual(stmt.shared, true, 'fixture precondition: it is shared in the tracked snapshot');
  stmt.shared = false;

  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409, 'an unshared multi-parent statement must block');
  const conflict = res.body.conflicts.find((c) => c.type === 'statement_not_shared');
  assert.ok(conflict, `expected statement_not_shared, got ${JSON.stringify(res.body.conflicts)}`);
  assert.match(String(conflict.statement), /mcp-authorization-denied|0004/);
  // It is referenced by seven rules — the report should say so, not name one id.
  assert.ok(conflict.referencedBy >= 2, `expected multi-parent count, got ${conflict.referencedBy}`);
});

test('step-up statement shared:false still caught (back-compat with the original hardcoded check)', async () => {
  const snapshot = loadSnapshot();
  const stmt = snapshot.find((o) => o.type === 'Statement' && o.id === STEP_UP_STATEMENT_ID);
  stmt.shared = false;

  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409);
  const conflict = res.body.conflicts.find(
    (c) => c.type === 'statement_not_shared' && /step-up-required|0003/.test(String(c.statement)),
  );
  assert.ok(conflict, `expected step-up statement_not_shared, got ${JSON.stringify(res.body.conflicts)}`);
});

test('a single-parent statement with shared:false is NOT flagged (no false positives)', async () => {
  const snapshot = loadSnapshot();
  // transaction-denied is referenced by exactly one rule and is shared:false already.
  const stmt = snapshot.find((o) => o.type === 'Statement' && o.code === 'transaction-denied');
  assert.strictEqual(stmt.shared, false, 'fixture precondition');

  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 200, `single-parent statements must not be flagged: ${JSON.stringify(res.body?.conflicts)}`);
  assert.strictEqual(res.body.valid, true);
});

// ── Malformed input still handled ───────────────────────────────────────────

test('malformed JSON still returns 400, not a crash', async () => {
  const res = makeRes();
  await importSnapshot({ file: { buffer: Buffer.from('{not json', 'utf8') } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'Invalid snapshot file');
});
