/**
 * @file snapshots/authorizeSnapshotDrift.test.js
 *
 * Coverage for the DecisionContext widening in gen-authorize-snapshot.js.
 *
 * Commit 1e8619d09 widened IsMcpFirstToolRequest from {McpFirstTool, McpToolCall}
 * to also match McpToolsList (tools/list) and McpRequest (session lifecycle).
 * Both cloud policies are guarded on that condition — the MCP Delegation policy
 * on it, the Transaction policy on its negation — so a DecisionContext missing
 * from the list is routed to the Transaction policy and, with no Amount present,
 * reaches only the always-true Permit Standard rule. That is a silent authz hole,
 * and it shipped with its correctness resting entirely on a commit message: the
 * commit added no test, and it did not commit the regenerated snapshot either,
 * so `--check` was red on a clean tree until this suite was added.
 *
 * PingOne Authorize has no policy API for COMPARISON conditions, so the cloud
 * policy is only updatable by snapshot import — which makes the committed
 * snapshot the deliverable, and drift in it invisible until an import fails.
 *
 * Run: node --test snapshots/authorizeSnapshotDrift.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const {
  reconcile,
  loadSot,
  MCP_DECISION_CONTEXTS,
  ATTR,
  COND,
  SNAP,
} = require('./gen-authorize-snapshot.js');

const readSnapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const findById = (snap, id) => snap.find((o) => o.id === id);

/** The DecisionContext values a condition's `or` branch actually matches. */
function matchedContexts(cond) {
  return (cond.condition.or.conditions || []).map((c) => {
    assert.strictEqual(
      c.comparison.left.attribute.id,
      ATTR.DecisionContext,
      'every branch must compare the DecisionContext attribute',
    );
    assert.strictEqual(c.comparison.op, 'Equals');
    return c.comparison.right.constant.value;
  });
}

test('IsMcpFirstToolRequest matches exactly MCP_DECISION_CONTEXTS', () => {
  const cond = findById(readSnapshot(), COND.IsMcpFirstToolRequest);
  assert.ok(cond, 'IsMcpFirstToolRequest condition must exist in the snapshot');

  assert.deepStrictEqual(
    matchedContexts(cond),
    MCP_DECISION_CONTEXTS,
    'committed snapshot must list exactly the contexts the generator declares',
  );
});

test('the widened contexts (McpToolsList, McpRequest) are the regression guard', () => {
  // Named explicitly: these two are what 1e8619d09 added. If a refactor drops
  // either from MCP_DECISION_CONTEXTS, tool discovery and session lifecycle
  // silently fall through to the Transaction policy again.
  const cond = findById(readSnapshot(), COND.IsMcpFirstToolRequest);
  for (const ctx of ['McpFirstTool', 'McpToolCall', 'McpToolsList', 'McpRequest']) {
    assert.ok(
      MCP_DECISION_CONTEXTS.includes(ctx),
      `${ctx} must route to the MCP Delegation policy`,
    );
    assert.ok(
      matchedContexts(cond).includes(ctx),
      `${ctx} missing from the committed snapshot condition`,
    );
  }
});

test('regeneration is idempotent — reconciling the committed snapshot is a no-op', () => {
  const committed = readSnapshot();
  const again = reconcile(clone(committed), loadSot());

  assert.deepStrictEqual(
    again,
    committed,
    'committed snapshot is out of date — run: node snapshots/gen-authorize-snapshot.js',
  );

  // Reconciling twice must also be stable (guards an accumulating splice).
  assert.deepStrictEqual(reconcile(again, loadSot()), committed);
});

test('widening touches exactly one object — 103 in, 103 out, none added or removed', () => {
  const committed = readSnapshot();
  const objectCount = committed.length;
  // 73 pre-cloud-delta objects + 30 added: 21 by the fine-grained deny steps,
  // 4 by the RAR amount-cap step, and 5 by the signing-key step (9 attributes,
  // 7 conditions, 7 statements, 7 rules in total) — pinned so an accidental
  // add/remove in the reconciler shows up as a count change here and in
  // authorizeSnapshotCloudDelta.test.js.
  assert.strictEqual(objectCount, 103, 'snapshot object count drifted — see authorizeSnapshotCloudDelta.test.js');

  // Rebuild the pre-1e8619d09 state: the condition matched only the first two
  // contexts. Everything else in the snapshot is already reconciled.
  const stale = clone(committed);
  const staleCond = findById(stale, COND.IsMcpFirstToolRequest);
  staleCond.description =
    'DecisionContext equals McpFirstTool — identifies this as an MCP first-tool ' +
    'gate request from the Super Banking BFF.';
  staleCond.condition = {
    or: {
      conditions: ['McpFirstTool', 'McpToolCall'].map((ctx) => ({
        comparison: {
          left: { attribute: { id: ATTR.DecisionContext } },
          op: 'Equals',
          right: { constant: { value: ctx } },
        },
      })),
    },
  };

  const differingBefore = stale.filter(
    (o, i) => JSON.stringify(o) !== JSON.stringify(committed[i]),
  );
  assert.strictEqual(differingBefore.length, 1, 'fixture should differ in one object');
  assert.strictEqual(differingBefore[0].id, COND.IsMcpFirstToolRequest);

  const reconciled = reconcile(stale, loadSot());

  assert.strictEqual(reconciled.length, objectCount, 'object count must not change');
  assert.strictEqual(committed.length, objectCount);

  const differingAfter = reconciled.filter(
    (o, i) => JSON.stringify(o) !== JSON.stringify(committed[i]),
  );
  assert.deepStrictEqual(
    differingAfter,
    [],
    'reconciling the stale condition must reproduce the committed snapshot exactly',
  );

  // And the object it changed is the one we staled — nothing else moved.
  assert.deepStrictEqual(
    matchedContexts(findById(reconciled, COND.IsMcpFirstToolRequest)),
    MCP_DECISION_CONTEXTS,
  );
});
