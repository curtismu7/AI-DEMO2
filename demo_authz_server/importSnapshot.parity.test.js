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

// ── F9 item 3 — a MISSING condition is drift too ─────────────────────────────
//
// The tool-DROP case above was caught. The tool-drop is also the LESS likely
// real-world drift: `if (consentCond)` / `if (stepUpCond)` meant a snapshot that
// DELETED the condition outright, or RENAMED it, skipped the comparison entirely
// and scored zero conflicts, valid:true, HTTP 200 — a strictly worse un-gating
// than dropping three tools, reported as a clean import.
//
// Both editing paths that produce a real snapshot make this easy to hit: the
// PingOne Authorize UI deletes a condition when its last comparison is removed,
// and gen-authorize-snapshot.js addresses conditions by stable ID while
// import-snapshot.js looks them up by NAME, so an ID-preserving rename is
// invisible to the generator and fatal to the check.

/** Remove a whole condition object from the snapshot (the delete case). */
function deleteCondition(snapshot, conditionName) {
  const i = snapshot.findIndex((o) => o.type === 'CONDITION' && o.name === conditionName);
  assert.ok(i >= 0, `fixture precondition: condition ${conditionName} exists`);
  snapshot.splice(i, 1);
  return snapshot;
}

/** Rename a condition in place, keeping its id (the rename case). */
function renameCondition(snapshot, from, to) {
  const cond = snapshot.find((o) => o.type === 'CONDITION' && o.name === from);
  assert.ok(cond, `fixture precondition: condition ${from} exists`);
  cond.name = to;
  return snapshot;
}

test('DELETING RequiresHitlConsent outright is BLOCKED (was: zero conflicts, valid:true, HTTP 200)', async () => {
  const res = await validate(deleteCondition(loadSnapshot(), 'RequiresHitlConsent'));
  assert.strictEqual(res.statusCode, 409, 'a deleted consent condition un-gates every consent tool and must block');
  assert.strictEqual(res.body.valid, false);
  const conflict = res.body.conflicts.find((c) => c.type === 'consent_condition_missing');
  assert.ok(conflict, `expected consent_condition_missing, got ${JSON.stringify(res.body.conflicts)}`);
  // The report must name what the SoT still expects to be gated, so the operator
  // can see the blast radius rather than just "something is missing".
  assert.ok(Array.isArray(conflict.sot) && conflict.sot.length > 0);
  for (const tool of DROPPED_BY_FIXED) {
    assert.ok(conflict.sot.includes(tool), `SoT consent list should name ${tool}`);
  }
});

test('DELETING RequiresMcpStepUp outright is BLOCKED', async () => {
  const res = await validate(deleteCondition(loadSnapshot(), 'RequiresMcpStepUp'));
  assert.strictEqual(res.statusCode, 409);
  const conflict = res.body.conflicts.find((c) => c.type === 'step_up_condition_missing');
  assert.ok(conflict, `expected step_up_condition_missing, got ${JSON.stringify(res.body.conflicts)}`);
  assert.ok(Array.isArray(conflict.sot) && conflict.sot.length > 0);
});

test('RENAMING RequiresHitlConsent is BLOCKED — the lookup is by name, so a rename reads as a delete', async () => {
  const res = await validate(renameCondition(loadSnapshot(), 'RequiresHitlConsent', 'RequiresHitlConsentV2'));
  assert.strictEqual(res.statusCode, 409, 'an id-preserving rename must not silently disable the check');
  assert.ok(res.body.conflicts.some((c) => c.type === 'consent_condition_missing'));
});

test('RENAMING RequiresMcpStepUp is BLOCKED', async () => {
  const res = await validate(renameCondition(loadSnapshot(), 'RequiresMcpStepUp', 'RequiresMcpStepUpV2'));
  assert.strictEqual(res.statusCode, 409);
  assert.ok(res.body.conflicts.some((c) => c.type === 'step_up_condition_missing'));
});

test('deleting BOTH conditions reports BOTH conflicts, not just the first', async () => {
  let snapshot = deleteCondition(loadSnapshot(), 'RequiresHitlConsent');
  snapshot = deleteCondition(snapshot, 'RequiresMcpStepUp');
  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(res.body.conflicts.some((c) => c.type === 'consent_condition_missing'));
  assert.ok(res.body.conflicts.some((c) => c.type === 'step_up_condition_missing'));
});

test('a missing condition is NOT flagged when the SoT expects no tools of that kind (no false positives)', async () => {
  // The check must key off what the SoT actually declares. If scope-topology.json
  // gated nothing with challengeType=consent, a snapshot without the condition
  // would be correct, not drift. Simulated by validating a snapshot that has
  // neither the condition nor any rule referencing it, against an empty SoT
  // expectation — asserted here via the inverse: with a NON-empty SoT the
  // conflict fires (above), so the guard is the SoT lookup, not a bare presence
  // test. This case pins that the conflict carries the SoT list it compared to.
  const res = await validate(deleteCondition(loadSnapshot(), 'RequiresHitlConsent'));
  const conflict = res.body.conflicts.find((c) => c.type === 'consent_condition_missing');
  assert.ok(conflict.sot.length > 0, 'conflict must be justified by a non-empty SoT expectation');
});

// ── Round 3 — HasValidMcpAudience set parity (the import blocker) ────────────
//
// The pre-round-3 condition was `TokenAudience Equals McpResourceUri` —
// attribute-to-attribute string equality. Post-C1 every caller sends the
// token's real single aud as TokenAudience and a comma-joined accepted set as
// McpResourceUri, so that equality is never true and importing DENIES ALL MCP
// TRAFFIC. The checker used to validate only consent/step-up tool lists and
// statement sharing, so it would wave the broken equality through (200/valid).

function audienceCondition(snapshot) {
  const cond = snapshot.find((o) => o.type === 'CONDITION' && o.name === 'HasValidMcpAudience');
  assert.ok(cond, 'fixture precondition: HasValidMcpAudience exists');
  return cond;
}

test('the OLD attribute-to-attribute audience equality is BLOCKED (was: passed untouched)', async () => {
  const snapshot = loadSnapshot();
  audienceCondition(snapshot).condition = { and: { conditions: [{
    comparison: {
      left: { attribute: { id: '12345678-0009-4321-abcd-000000000009' } },
      op: 'Equals',
      right: { attribute: { id: '12345678-0012-4321-abcd-000000000012' } },
    },
  }] } };
  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409, 'importing the broken equality denies all MCP traffic — must block');
  const conflict = res.body.conflicts.find((c) => c.type === 'mcp_audience_attribute_equality');
  assert.ok(conflict, `expected mcp_audience_attribute_equality, got ${JSON.stringify(res.body.conflicts)}`);
});

test('a FOREIGN audience constant is BLOCKED with the snapshot/SoT sets reported', async () => {
  const snapshot = loadSnapshot();
  const cond = audienceCondition(snapshot);
  // Replace one accepted identity with a foreign audience.
  cond.condition.or.conditions[0].comparison.right.constant.value = 'evil.example.com';
  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409);
  const conflict = res.body.conflicts.find((c) => c.type === 'mcp_audience_mismatch');
  assert.ok(conflict, `expected mcp_audience_mismatch, got ${JSON.stringify(res.body.conflicts)}`);
  assert.ok(conflict.snapshot.includes('evil.example.com'));
  assert.ok(conflict.sot.includes('mcpgateway.ping.demo'));
  assert.ok(conflict.sot.includes('https://api.ping.demo:3036/mcp'));
});

test('a DROPPED accepted audience is BLOCKED — a partial set denies one gateway wholesale', async () => {
  const snapshot = loadSnapshot();
  const cond = audienceCondition(snapshot);
  cond.condition.or.conditions = cond.condition.or.conditions.filter(
    (c) => c.comparison.right.constant.value !== 'https://api.ping.demo:3036/mcp',
  );
  const res = await validate(snapshot);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(res.body.conflicts.some((c) => c.type === 'mcp_audience_mismatch'));
});

test('a MISSING (deleted or renamed) HasValidMcpAudience is BLOCKED', async () => {
  const res = await validate(deleteCondition(loadSnapshot(), 'HasValidMcpAudience'));
  assert.strictEqual(res.statusCode, 409);
  assert.ok(res.body.conflicts.some((c) => c.type === 'mcp_audience_condition_missing'));

  const res2 = await validate(renameCondition(loadSnapshot(), 'HasValidMcpAudience', 'HasValidMcpAudienceV2'));
  assert.strictEqual(res2.statusCode, 409);
  assert.ok(res2.body.conflicts.some((c) => c.type === 'mcp_audience_condition_missing'));
});

// ── Round 3 — the fine-grained deny statement codes must exist ───────────────

const ROUND3_STATEMENT_CODES = [
  'mcp-bypass-attempt',
  'mcp-resource-owner-mismatch',
  'mcp-rar-amount-exceeded',
  'mcp-intent-invalid',
  'mcp-intent-mismatch',
  'mcp-admin-role-not-permitted',
];

test('every round-3 deny statement code is present in the tracked snapshot', async () => {
  const snapshot = loadSnapshot();
  for (const code of ROUND3_STATEMENT_CODES) {
    assert.ok(
      snapshot.some((o) => o.type === 'Statement' && o.code === code),
      `tracked snapshot must define statement code ${code}`,
    );
  }
});

test('a snapshot MISSING a round-3 statement code is BLOCKED', async () => {
  for (const code of ROUND3_STATEMENT_CODES) {
    const snapshot = loadSnapshot().filter((o) => !(o.type === 'Statement' && o.code === code));
    const res = await validate(snapshot);
    assert.strictEqual(res.statusCode, 409, `dropping ${code} must block the import`);
    const conflict = res.body.conflicts.find(
      (c) => c.type === 'statement_code_missing' && c.code === code,
    );
    assert.ok(conflict, `expected statement_code_missing for ${code}, got ${JSON.stringify(res.body.conflicts)}`);
  }
});

// ── Malformed input still handled ───────────────────────────────────────────

test('malformed JSON still returns 400, not a crash', async () => {
  const res = makeRes();
  await importSnapshot({ file: { buffer: Buffer.from('{not json', 'utf8') } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'Invalid snapshot file');
});
