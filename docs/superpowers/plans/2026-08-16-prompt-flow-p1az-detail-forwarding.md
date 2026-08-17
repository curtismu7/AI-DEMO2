# P1AZ Detail Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward the same rich decision record `auditDecision()` already builds (and currently only logs to stdout) into the transaction-hop `details` field, so PERMIT/DENY/INDETERMINATE entries the mock Authorization Server writes to the shared transaction ledger carry full decision context instead of a bare `{outcome, by, reason}`.

**Architecture:** `logger.js`'s `auditDecision()` currently builds a JSON record from four sources — the four literal args (`decision`, `reason`), the ALS decision context (`decisionContext`/`tool`/`sub`/`actor`/`workerId`, stashed once per request via `setDecisionContext()`), and (after this plan) five more ALS-carried fields (`scopes`/`rarPresent`/`intentValid`/`intentMatch`/`hitlApproved`) plus two caller-supplied extras (`decisionId`/`policyVersion`, generated fresh inside each terminal response helper) — then only `console.log`s it. This plan makes `auditDecision()` return that record instead of just logging it, widens what `setDecisionContext()` is called with, and has `routes/decision.js`'s `permit()`/`permitWithAdvice()`/`deny()`/`indeterminate()` (plus the inline ELICITATION response) capture the returned record and pass it straight into `_emitDecisionHop()`'s new `details` parameter — one computed object, two destinations (stdout + ledger), no divergence.

**Tech Stack:** Node.js (`node --test`, no Jest in this service), plain CommonJS, `demo_authz_server/`.

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md

## Global Constraints

- No schema migration: the ledger's `details` field already accepts an arbitrary object (gateway hops use it today for DPoP/RAR posture) — this change only widens what one existing call site sends into an already-generic field.
- One computation, two destinations, no divergence: the object forwarded as the hop's `details` must be the exact object `auditDecision()` builds and logs to stdout for that same decision — not a re-derived or trimmed copy.
- Hop emission is fire-and-forget and must never block or fail a decision — `emitHop()` (`demo_authz_server/transactionHop.js`) already wraps its POST in `try/catch` + `.catch(() => {})` and is unchanged by this plan; do not add any `await` on it.
- `policy_version` is currently hardcoded to the literal string `'mock-v1'` in every response (`permit`/`deny`/`indeterminate`/`permitWithAdvice`/the ELICITATION response) — this plan forwards that literal into the audit record and hop `details` as-is. Do NOT replace it with a real imported snapshot version; that is out of scope.
- Scope is `demo_authz_server` only — do not touch `demo_api_server`, `demo_mcp_gateway`, `demo_llm_proxy`, `langchain_agent`, or any UI files (sibling plans own those, including the gateway's own detail-forwarding plan at `docs/superpowers/plans/2026-08-16-prompt-flow-gateway-detail-forwarding.md`).
- Touch only what you must: no unrelated refactors to `logger.js` or `routes/decision.js` beyond the changes below. Every `deny()`/`permit()`/`indeterminate()`/`permitWithAdvice()` call site in `routes/decision.js` keeps its existing call signature (`(res, reason[, code])` / `(res, reason, advice)`) — only the four functions' internals change.
- This service uses Node's built-in test runner (`node --test`), matching `package.json`'s `"test": "node --test"` script and every existing `*.test.js` file in this directory — do NOT introduce Jest or any Jest-style `describe`/`expect` syntax.
- The full `node --test` suite in this worktree has 9 pre-existing failures unrelated to this work (baseline, confirmed before this plan was written). Verification for this plan means the specific files touched/added below pass, and no previously-passing test regresses — not that the full suite goes green.

---

### Task 1: `auditDecision()` returns the enriched record it logs

**Files:**
- Modify: `demo_authz_server/logger.js:40-55`
- Test: `demo_authz_server/tests/logger.test.js` (new file)

**Interfaces:**
- Consumes: `getCorrelationId()`, `getDecisionContext()` from `./correlationContext` (existing, unchanged signatures); `setDecisionContext(fields)` from `./correlationContext` (existing, unchanged — generic `Object.assign` onto the ALS decision-context object, already used by `routes/decision.js`).
- Produces: `auditDecision(decision, reason, extra)` where `extra` is an optional `{decisionId?: string, policyVersion?: string}` — returns (and still logs) the full record `{evt, decision, reason, correlationId, decisionContext, tool, sub, actor, workerId, scopes, rarPresent, intentValid, intentMatch, hitlApproved, decisionId, policyVersion}`. Reads `scopes`/`rarPresent`/`intentValid`/`intentMatch`/`hitlApproved` off whatever `getDecisionContext()` currently returns (defaulting to `[]`/`false`/`null`/`null`/`false` when absent) — Task 2 is what starts populating those ALS fields for real requests.

- [ ] **Step 1: Write the failing test**

Create `demo_authz_server/tests/logger.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_authz_server && node --test tests/logger.test.js`

Expected: FAIL — `auditDecision()` currently returns `undefined`, so `record.decision` throws `TypeError: Cannot read properties of undefined (reading 'decision')`.

- [ ] **Step 3: Write minimal implementation**

In `demo_authz_server/logger.js`, replace the existing `auditDecision` function (lines 40-55) with:

```javascript
/**
 * Emit a structured audit record for a decision, and return the same record
 * so callers (routes/decision.js's permit()/deny()/indeterminate() helpers)
 * can forward it verbatim as the transaction-hop `details` field — one
 * computed object, two destinations (stdout + ledger), no chance of drift.
 *
 * PERMIT is audited alongside DENY / INDETERMINATE so the stdout trail is
 * complete for a human reading container logs. Note this sink is stdout-only —
 * the machine-readable path the reconciler uses is transactionHop.emitHop.
 * @param {'PERMIT'|'DENY'|'INDETERMINATE'} decision
 * @param {string} reason
 * @param {{decisionId?: string, policyVersion?: string}} [extra] - fields the
 *   terminal response helpers compute themselves (decision_id/policy_version
 *   are generated inline in permit()/deny()/indeterminate(), not carried in
 *   the ALS decision context).
 * @returns {object} the full record that was logged
 */
function auditDecision(decision, reason, extra) {
  const ctx = getDecisionContext();
  const record = {
    evt: 'authz_decision',
    decision,
    reason: reason || null,
    correlationId: getCorrelationId() || null,
    decisionContext: ctx.decisionContext || null,
    tool: ctx.tool || null,
    sub: ctx.sub || null,
    actor: ctx.actor || null,
    workerId: ctx.workerId || null,
    scopes: ctx.scopes || [],
    rarPresent: ctx.rarPresent || false,
    intentValid: ctx.intentValid || null,
    intentMatch: ctx.intentMatch || null,
    hitlApproved: ctx.hitlApproved || false,
    decisionId: (extra && extra.decisionId) || null,
    policyVersion: (extra && extra.policyVersion) || null,
  };
  console.log(JSON.stringify(record));
  return record;
}
```

`module.exports = { log, warn, auditDecision };` at the bottom of the file stays unchanged — no new exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_authz_server && node --test tests/logger.test.js`

Expected: PASS
```
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Then confirm the existing correlation test (which parses the same stdout audit line and checks a subset of fields) still passes: `cd demo_authz_server && node --test decision.correlation.test.js`

Expected: PASS, all 3 tests (the new fields are additive — `decision.correlation.test.js` only asserts `record.decision`/`.correlationId`/`.tool`/`.sub`/`.actor`/`.reason`, none of which changed shape).

- [ ] **Step 5: Commit**

```bash
git add demo_authz_server/logger.js demo_authz_server/tests/logger.test.js
git commit -m "authz: auditDecision returns the record it logs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the enriched record into every decision hop

**Files:**
- Modify: `demo_authz_server/routes/decision.js:279-285` (the `setDecisionContext()` call)
- Modify: `demo_authz_server/routes/decision.js:957-970` (the ELICITATION inline response)
- Modify: `demo_authz_server/routes/decision.js:1023-1094` (`_emitDecisionHop` and the four terminal helpers)
- Test: `demo_authz_server/tests/decision.transactionHop.test.js` (append to existing file)

**Interfaces:**
- Consumes: `auditDecision(decision, reason, extra)` returning the enriched record (Task 1); `setDecisionContext(fields)` (existing, unchanged, from `../correlationContext`); `emitHop(hop)` (existing, unchanged, from `../transactionHop` — it spreads whatever object it's given onto the POST body, so no change needed there).
- Produces: `_emitDecisionHop(outcome, reason, details)` — every `authz.decision` hop now carries `details` = the exact record `auditDecision()` built for that decision (`scopes`, `rarPresent`, `intentValid`, `intentMatch`, `hitlApproved`, `decisionId`, `policyVersion` included). `decisionId` inside `details` now matches the `decision_id` returned in the same response's JSON body (previously each called `randomId()` independently and could never match).

- [ ] **Step 1: Write the failing test**

Append these three tests to `demo_authz_server/tests/decision.transactionHop.test.js`, immediately after the existing `'WIRE-5: hop emission does not alter the decision response body shape'` test (after its closing `});`, before end of file):

```javascript
test('WIRE-6: a PERMIT hop carries a details payload matching the full decision context (scopes/RAR/intent/HITL/decisionId/policyVersion)', async () => {
  const body = await decide(baseWriteParams(), 'cid-details-permit-1');
  assert.strictEqual(body.decision, 'PERMIT');
  assert.strictEqual(calls.length, 1);
  const hop = calls[0].body;
  assert.ok(hop.details, 'hop must carry a details payload');
  assert.strictEqual(hop.details.evt, 'authz_decision');
  assert.strictEqual(hop.details.decision, 'PERMIT');
  assert.strictEqual(hop.details.correlationId, 'cid-details-permit-1');
  assert.strictEqual(hop.details.tool, 'update_contact_email');
  assert.strictEqual(hop.details.sub, 'user-alice');
  assert.strictEqual(hop.details.actor, 'agent-1');
  assert.deepStrictEqual(hop.details.scopes, ['write']);
  assert.strictEqual(hop.details.rarPresent, false);
  assert.strictEqual(hop.details.hitlApproved, false);
  assert.strictEqual(hop.details.decisionId, body.decision_id, 'hop details.decisionId must match the response decision_id');
  assert.strictEqual(hop.details.policyVersion, body.policy_version);
});

test('WIRE-7: a DENY hop carries details.reason matching the response reason, and reflects RAR presence', async () => {
  const body = await decide(
    baseWriteParams({
      ResourceOwnerId: 'user-bob',
      ClientId: 'user-alice',
      RarAuthorizationDetails: '[{"type":"transfer"}]',
    }),
    'cid-details-deny-1',
  );
  assert.strictEqual(body.decision, 'DENY');
  assert.strictEqual(calls.length, 1);
  const hop = calls[0].body;
  assert.strictEqual(hop.details.decision, 'DENY');
  assert.strictEqual(hop.details.reason, body.reason);
  assert.strictEqual(hop.details.rarPresent, true);
  assert.strictEqual(hop.details.decisionId, body.decision_id);
});

test('WIRE-8: hop.details exactly matches the stdout authz_decision audit record — no divergence between the two sinks', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  let body;
  try {
    body = await decide(baseWriteParams(), 'cid-details-parity-1');
  } finally {
    console.log = orig;
  }
  assert.strictEqual(body.decision, 'PERMIT');
  const auditLine = lines.find((l) => l.includes('"evt":"authz_decision"'));
  assert.ok(auditLine, 'expected a structured authz_decision audit line');
  const auditRecord = JSON.parse(auditLine);
  const hop = calls[0].body;
  assert.deepStrictEqual(hop.details, auditRecord, 'hop.details must exactly match the stdout audit record');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_authz_server && node --test tests/decision.transactionHop.test.js`

Expected: the 5 existing `WIRE-1`..`WIRE-5` tests PASS; the 3 new tests FAIL — `hop.details` is `undefined` today, so e.g. `assert.ok(hop.details, ...)` fails with:
```
AssertionError [ERR_ASSERTION]: hop must carry a details payload
```

- [ ] **Step 3: Write minimal implementation**

In `demo_authz_server/routes/decision.js`, make four edits.

**3a — widen the `setDecisionContext()` call (currently lines 279-285)** so the ALS decision context carries the fields `auditDecision()` now reads. `grantedScopes` (a `Set`, built at line 241 from `TokenScopes`) and `hitlApproved` (the final boolean, computed by line 274) are both already in scope here:

```javascript
  setDecisionContext({
    decisionContext: DecisionContext || null,
    tool: ToolName || null,
    sub: ClientId || null,
    actor: ActClientId || null,
    workerId: workerId || null,
    scopes: Array.from(grantedScopes),
    rarPresent: Boolean(RarAuthorizationDetails),
    intentValid: IntentTokenValid || null,
    intentMatch: IntentMatchesTool || null,
    hitlApproved,
  });
```

**3b — the ELICITATION inline response (currently lines 957-970)** — generate `decisionId` once and forward the returned record:

```javascript
  if (params.ToolDestructive === 'true' && params.ElicitationConfirmed !== 'true') {
    log(`[AuthzServer/decision] INDETERMINATE — ELICITATION: tool="${ToolName}" is destructive, confirmation absent`);
    const decisionId = randomId();
    const record = auditDecision('INDETERMINATE', 'ELICITATION', { decisionId, policyVersion: 'mock-v1' });
    _emitDecisionHop('n/a', 'ELICITATION', record);
    return res.json({
      decision: 'INDETERMINATE',
      reason: 'ELICITATION',
      statements: statementsFor('ELICITATION'),
      advice: [{ id: 'elicitation-prompt', value: `Confirm ${ToolName}?` }],
      policy_source: POLICY_SOURCE,
      decision_id: decisionId,
      policy_version: 'mock-v1',
    });
  }
```

**3c — `_emitDecisionHop` (currently lines 1023-1032)** — accept and forward `details`:

```javascript
function _emitDecisionHop(outcome, reason, details) {
  const ctx = getDecisionContext();
  emitHop({
    phase: 'authz.decision',
    op: ctx.tool || null,
    identity: { sub: ctx.sub || null, act: ctx.actor ? [ctx.actor] : [] },
    decision: { outcome, by: 'mock', reason: reason || null },
    status: 'ok',
    details: details || null,
  });
}
```

**3d — the four terminal helpers (currently lines 1052-1094)** — generate `decisionId` once, reuse it for both the audit/hop record and the response body:

```javascript
function permit(res, reason) {
  const decisionId = randomId();
  const record = auditDecision('PERMIT', reason, { decisionId, policyVersion: 'mock-v1' });
  _emitDecisionHop('permit', reason, record);
  res.json({
    decision: 'PERMIT', reason,
    statements: statementsFor('mcp-tool-authorized'),
    policy_source: POLICY_SOURCE,
    decision_id: decisionId, policy_version: 'mock-v1',
  });
}

function permitWithAdvice(res, reason, advice) {
  const decisionId = randomId();
  const record = auditDecision('PERMIT', reason, { decisionId, policyVersion: 'mock-v1' });
  _emitDecisionHop('permit', reason, record);
  res.json({
    decision: 'PERMIT', reason, advice,
    statements: statementsFor('mcp-tool-authorized'),
    policy_source: POLICY_SOURCE,
    decision_id: decisionId, policy_version: 'mock-v1',
  });
}

function deny(res, reason, code) {
  const decisionId = randomId();
  const record = auditDecision('DENY', reason, { decisionId, policyVersion: 'mock-v1' });
  _emitDecisionHop('deny', reason, record);
  res.json({
    decision: 'DENY', reason,
    statements: statementsFor(code || denyCodeFor(reason)),
    policy_source: POLICY_SOURCE,
    decision_id: decisionId, policy_version: 'mock-v1',
  });
}

function indeterminate(res, reason, code) {
  const decisionId = randomId();
  const record = auditDecision('INDETERMINATE', reason, { decisionId, policyVersion: 'mock-v1' });
  _emitDecisionHop('n/a', reason, record);
  res.json({
    decision: 'INDETERMINATE', reason,
    statements: statementsFor(code),
    policy_source: POLICY_SOURCE,
    decision_id: decisionId, policy_version: 'mock-v1',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_authz_server && node --test tests/decision.transactionHop.test.js`

Expected: PASS
```
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Then confirm no regression in the directly related, unmodified test files:

Run: `cd demo_authz_server && node --test decision.correlation.test.js tests/transactionHop.test.js`

Expected: PASS, all tests (`decision.correlation.test.js` still asserts the same subset of `auditDecision`'s output fields it always has; `tests/transactionHop.test.js` exercises `emitHop()` directly and is untouched by this task).

- [ ] **Step 5: Commit**

```bash
git add demo_authz_server/routes/decision.js demo_authz_server/tests/decision.transactionHop.test.js
git commit -m "authz: forward the full decision record into the ledger hop details

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** The spec's P1AZ paragraph (§2) requires exactly one behavioral change: "pass the same rich object `auditDecision()` builds into the hop's `details` field, so PERMIT/DENY/INDETERMINATE in the ledger carries the full decision context, not just the verdict." Task 1 makes that object capturable (return value instead of log-only side effect) and widens it to include the fields the spec explicitly names — `scopes`, RAR presence, `intentMatch`, `intentValid`, `hitlApproved`, `policy_version`, `decision_id` — none of which were actually part of `auditDecision()`'s built object before this plan (verified by reading `logger.js` and `routes/decision.js` directly: those fields existed only as local variables used in a human-readable `log()` line at `routes/decision.js:287`, or as literals generated fresh inside the response JSON of `permit()`/`deny()`/`indeterminate()` — never in the structured record `auditDecision()` logs). Task 2 threads the missing fields into the ALS decision context (`scopes`/`rarPresent`/`intentValid`/`intentMatch`/`hitlApproved`, all already in scope at the existing `setDecisionContext()` call site) and into `auditDecision()`'s new `extra` parameter (`decisionId`/`policyVersion`, generated where they always were — inside the terminal helpers — but now hoisted once and reused for both the audit record and the JSON response instead of two independent `randomId()` calls that could never agree). Every call site that emits a decision hop (`permit`, `permitWithAdvice`, `deny`, `indeterminate`, and the inline ELICITATION response) is updated — confirmed exhaustive via `grep -n "auditDecision(\|_emitDecisionHop("` against `routes/decision.js`, five call sites, all covered. WIRE-8 adds the "regression guard against the two diverging again" the spec's §7 testing bullet calls for (stdout audit line vs. ledger `details` deep-equal). Nothing outside `demo_authz_server` is touched, matching the assignment's scope boundary.

**Placeholder scan:** No TBD/TODO, no "add appropriate error handling," no "similar to Task N" (Task 2's four terminal-helper bodies are each written out in full rather than referenced). Every step shows complete, runnable code and an exact command with expected output.

**Naming consistency:** `details` is the field name at every hand-off — `_emitDecisionHop(outcome, reason, details)`'s parameter, the `emitHop({ ..., details })` call, and `hop.details` in the tests — matching the sibling gateway plan's naming (`TransactionHopInput.details`) so both `authz.decision` and `gateway.authorize` hops expose the enriched payload under the same key. `scopes`/`rarPresent`/`intentValid`/`intentMatch`/`hitlApproved`/`decisionId`/`policyVersion` are used identically across the `setDecisionContext()` call (producer), `auditDecision()` (reader/builder), and the new tests (consumer) — no `decision_id` vs `decisionId` or `policy_version` vs `policyVersion` drift inside the internal camelCase record (the snake_case `decision_id`/`policy_version` keys stay confined to the external, PingOne-contract-shaped `res.json()` bodies, exactly as they were before this plan).
