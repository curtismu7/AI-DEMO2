# Remaining Tried-vs-Allowed Attack Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For the remaining 4 real attack-demo chips (wrong-scope, confused-deputy, HITL-replay,
cross-vertical-deny), show both what was tried and what is actually allowed, using only real
data — either already available and unused, or a small, precisely-scoped backend addition.

**Architecture:** Two of the four (wrong-scope, cross-vertical-deny) are pure UI changes — the
real "allowed" data already exists client-side (an error object's unused fields, or an
already-fetched tool-permissions map) and is simply not rendered. The other two (confused-deputy,
HITL-replay) need one small backend field each, added at the exact point each value is already
computed but currently discarded, gated so it only appears on the relevant demo request (never
attached to ordinary tool-call responses).

**Tech Stack:** Node.js/Express (BFF), React (UI), Jest (backend), Vitest (UI).

## Global Constraints

- No change to `demo_authz_server/routes/decision.js` (the mock authz server) — it is not in the
  live default deployment's call path (real cloud PingOne Authorize is), so editing it would not
  affect what the demo actually shows by default.
- Every new backend field must be gated so it only appears on the specific demo request that
  needs it (confused-deputy: only when `req.body?._testActClientId` was sent; HITL-replay: only
  when a receipt-verification rejection actually occurred) — never attached unconditionally to
  ordinary tool-call/gate responses.
- Match each file's existing conventions exactly: `mcpToolPipeline.js` uses inline
  `require('./configStore')` (not a top-level import) — follow that, don't introduce a new
  top-level import.
- New UI tests for each attack follow the exact pattern already established and proven in
  `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js` (real end-to-end RTL test:
  expand the "Testing"/showcase group, click the real chip, mock only `global.fetch`, assert on
  the real rendered message) — read that file in full before writing a new test, copy its
  boilerplate mock block verbatim, and drive the real component rather than reimplementing logic.

---

## Task 1: Wrong scope — show tried vs. allowed scopes (UI only)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `case "test_wrong_scope":` block, lines 2965-3026)
- Modify: `demo_api_ui/src/__tests__/BankingAgent.integration.test.js` (remove the stale placeholder `describe('test_wrong_scope handler', ...)` block, lines 239-270 — these 5 `expect(true).toBe(true)` tests describe a `_testScope`-based approach that doesn't match the current `callMcpTool("admin_get_all_users", {})` implementation even before this task's change)
- Create: `demo_api_ui/src/components/__tests__/AIAgent.wrongScope.test.js`

**Interfaces:**
- Consumes: `demo_api_ui/src/services/demoAgentService.js:436-451`'s thrown error object, which already carries `requiredScopes: string[]`, `availableScopes: string[]`, `missingScopes: string[]` (all real, from `mcpToolPipeline.js:785-791`'s response body) — confirmed already present, no backend change needed.

- [ ] **Step 1: Write the failing UI test**

Read `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js` in full first — copy its
entire mock boilerplate block (all the `vi.mock(...)` calls) verbatim into the new file, changing
only what's needed to target the `test_wrong_scope` chip and to mock `callMcpTool` (imported from
`../../services/demoAgentService`, already mocked in that reference file's
`demoAgentService` mock block — extend that mock's `callMcpTool` implementation per-test instead
of using `global.fetch`, since `test_wrong_scope` calls `callMcpTool`, not a raw `fetch`).

Create `demo_api_ui/src/components/__tests__/AIAgent.wrongScope.test.js` with tests asserting:
1. When `callMcpTool` rejects with an error carrying `{code: "mcp_scope_denied", statusCode: 403, tool: "admin_get_all_users", requiredScopes: ["admin"], availableScopes: ["read", "write"], missingScopes: ["admin"]}`, the resulting chat message contains both `requiredScopes` and `availableScopes` values (not just `missingScopes`).
2. The message still correctly reports the denial when `availableScopes` is absent/empty (defensive — don't crash on a partial response shape).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongScope.test.js`
Expected: FAIL — the current message only includes `missingScopes`, not `requiredScopes`/`availableScopes`.

- [ ] **Step 3: Update the `test_wrong_scope` case**

In `demo_api_ui/src/components/AIAgent.js`, modify the `case "test_wrong_scope":` block
(lines 2965-3026). Current message-building (lines 2986-3009):

```javascript
          const scopeRejected =
            scopeTestRes?.status === 403 ||
            scopeTestRes?.error === "agent_mcp_scope_denied" ||
            scopeTestRes?.error?.includes("scope");
          const scopeOutcome = scopeRejected
            ? `✅ Gateway correctly rejected (403): required_scopes=[${(scopeTestRes.missingScopes || []).join(", ") || "admin"}]`
            : `❌ Expected 403 denial, got: ${scopeTestRes?.error || scopeTestRes?.status || "success"}`;
          addMessage(
            "token-event",
            [
              "⚠️ Authorization Test: Insufficient Scope (RFC 6749 §3.3)",
              "",
              scopeOutcome,
              "",
              "Step 4b-c: Gateway denial includes required_scopes metadata",
              `Status: ${scopeTestRes?.status || "?"}`,
              `Error: ${scopeTestRes?.error || "none"}`,
              `Missing scopes: [${(scopeTestRes?.missingScopes || []).join(", ") || "admin"}]`,
              "",
              "RFC 6749 §3.3 — The `scope` parameter limits what an access token can do.",
              "   Resource servers MUST reject requests where the token lacks required scopes.",
              "RFC 8693 §2.1 — Token exchange can only narrow (not expand) scopes.",
              "   MCP token inherits user token's scopes; cannot gain new scopes.",
            ].join("\n"),
            actionId,
          );
```

Replace with:

```javascript
          const scopeRejected =
            scopeTestRes?.status === 403 ||
            scopeTestRes?.error === "agent_mcp_scope_denied" ||
            scopeTestRes?.error?.includes("scope");
          const scopeOutcome = scopeRejected
            ? `✅ Gateway correctly rejected (403): required_scopes=[${(scopeTestRes.missingScopes || []).join(", ") || "admin"}]`
            : `❌ Expected 403 denial, got: ${scopeTestRes?.error || scopeTestRes?.status || "success"}`;
          const scopeComparisonLines =
            scopeTestRes?.availableScopes?.length || scopeTestRes?.requiredScopes?.length
              ? [
                  `Tried: token scopes=[${(scopeTestRes.availableScopes || []).join(", ") || "none"}]`,
                  `Allowed (required): scopes=[${(scopeTestRes.requiredScopes || []).join(", ") || "unknown"}]`,
                  "",
                ]
              : [];
          addMessage(
            "token-event",
            [
              "⚠️ Authorization Test: Insufficient Scope (RFC 6749 §3.3)",
              "",
              ...scopeComparisonLines,
              scopeOutcome,
              "",
              "Step 4b-c: Gateway denial includes required_scopes metadata",
              `Status: ${scopeTestRes?.status || "?"}`,
              `Error: ${scopeTestRes?.error || "none"}`,
              `Missing scopes: [${(scopeTestRes?.missingScopes || []).join(", ") || "admin"}]`,
              "",
              "RFC 6749 §3.3 — The `scope` parameter limits what an access token can do.",
              "   Resource servers MUST reject requests where the token lacks required scopes.",
              "RFC 8693 §2.1 — Token exchange can only narrow (not expand) scopes.",
              "   MCP token inherits user token's scopes; cannot gain new scopes.",
            ].join("\n"),
            actionId,
          );
```

- [ ] **Step 4: Remove the stale placeholder tests**

In `demo_api_ui/src/__tests__/BankingAgent.integration.test.js`, delete the entire
`describe('test_wrong_scope handler', ...)` block (lines 239-270).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongScope.test.js src/__tests__/BankingAgent.integration.test.js`
Expected: All pass.

- [ ] **Step 6: Run regression-guard's build gate**

Per this repo's CLAUDE.md, invoke the regression-guard skill (touches `demo_api_ui`) and run its build gate before finishing.

- [ ] **Step 7: Commit**

```bash
cd demo_api_ui
git add src/components/AIAgent.js src/__tests__/BankingAgent.integration.test.js src/components/__tests__/AIAgent.wrongScope.test.js
git commit -m "fix(ui): show tried vs. allowed scopes on the wrong-scope attack chip"
```

---

## Task 2: Confused deputy — show the real allowed actor (backend + UI)

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js` (the `gateway_policy_denied` 403 return, around lines 877-883)
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `atk_confused_deputy` block, lines 6866-6903)
- Create: `demo_api_server/src/__tests__/mcpToolPipeline.confusedDeputy.test.js`
- Create: `demo_api_ui/src/components/__tests__/AIAgent.confusedDeputy.test.js`

**Interfaces:**
- Produces: `mcpToolPipeline.js`'s `gateway_policy_denied` block body gains an optional
  `allowedActor: string | null` field, present only when the originating request had
  `req.body?._testActClientId` set.

- [ ] **Step 1: Write the failing backend test**

Create `demo_api_server/src/__tests__/mcpToolPipeline.confusedDeputy.test.js`. Read
`demo_api_server/src/__tests__/mcpToolPipeline.characterization.test.js` in full first and copy
its `makeDeps()`/`makeCtx()` DI-factory pattern verbatim (do not use `jest.mock()` — this file's
own convention is dependency injection). Extend `makeCtx()`'s `req` to accept a `body` field.

```javascript
'use strict';
/**
 * Covers the confused-deputy allowedActor field added to the gateway_policy_denied
 * block — see docs/superpowers/plans/2026-07-13-remaining-tried-vs-allowed.md Task 2.
 */
const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

// Copy makeDeps() and makeCtx() verbatim from mcpToolPipeline.characterization.test.js,
// then extend makeCtx() to accept a `reqBody` override merged into `req.body`.

describe('gateway_policy_denied — allowedActor field', () => {
  test('includes allowedActor when the request set _testActClientId', async () => {
    const deps = makeDeps();
    deps.callToolViaGateway = jest.fn(async () => {
      throw Object.assign(new Error('denied'), {
        code: 'gateway_policy_denied',
        httpStatus: 403,
        gatewayErrorCode: 'mcp-invalid-actor',
      });
    });
    const configStore = require('../../services/configStore');
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) =>
      key === 'pingone_ai_agent_client_id' ? 'real-agent-client-id' : null,
    );
    const outcome = await runMcpToolPipeline(
      makeCtx({ deps, req: { body: { _testActClientId: 'rogue-agent-9f2a-not-allowlisted' } } }),
    );
    expect(outcome.body.allowedActor).toBe('real-agent-client-id');
  });

  test('omits allowedActor on an ordinary (non-confused-deputy) gateway denial', async () => {
    const deps = makeDeps();
    deps.callToolViaGateway = jest.fn(async () => {
      throw Object.assign(new Error('denied'), {
        code: 'gateway_policy_denied',
        httpStatus: 403,
        gatewayErrorCode: 'some_other_reason',
      });
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps, req: { body: {} } }));
    expect(outcome.body.allowedActor).toBeUndefined();
  });
});
```

If `makeCtx()`'s signature doesn't already accept a `req` override the way this snippet assumes,
read its actual definition in `mcpToolPipeline.characterization.test.js` and adjust the test to
match its real shape — do not guess further; adjust the test to fit the real factory.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolPipeline.confusedDeputy.test.js`
Expected: FAIL — `outcome.body.allowedActor` is `undefined` in the first test (should be `'real-agent-client-id'`).

- [ ] **Step 3: Add the `allowedActor` field**

In `demo_api_server/services/mcpToolPipeline.js`, find the `gateway_policy_denied`/`gateway_auth_failed` 403 return (the final `return` inside that `if` block, currently):

```javascript
            return { kind: 'block', httpStatus: 403, tokenEvents, body: {
                error: 'gateway_policy_denied',
                tool,
                gatewayErrorCode: err.gatewayErrorCode || err.code,
                message: err.message,
                tokenEvents,
            } };
```

Change to:

```javascript
            return { kind: 'block', httpStatus: 403, tokenEvents, body: {
                error: 'gateway_policy_denied',
                tool,
                gatewayErrorCode: err.gatewayErrorCode || err.code,
                message: err.message,
                tokenEvents,
                ...(req.body?._testActClientId
                    ? { allowedActor: require('./configStore').getEffective('pingone_ai_agent_client_id') || null }
                    : {}),
            } };
```

(`req` is already destructured at the top of `runMcpToolPipeline` — `const { tool, req, deps } = ctx;`
— and already read the same way at line 599 for `testActClientId`, so this is consistent with the
file's existing pattern. `require('./configStore')` inline matches the file's own existing
convention at line 590, not a new top-level import.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolPipeline.confusedDeputy.test.js`
Expected: Both tests PASS.

- [ ] **Step 5: Run the existing characterization test to check for regressions**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolPipeline.characterization.test.js`
Expected: All pass (the `gateway_policy_denied` characterization test(s) should still pass since `allowedActor` is only added when `_testActClientId` is set, which those tests don't set).

- [ ] **Step 6: Write the failing UI test**

Create `demo_api_ui/src/components/__tests__/AIAgent.confusedDeputy.test.js`, following the same
boilerplate-copy approach as Task 1 (copy `AIAgent.wrongAudience.test.js`'s mock block verbatim).
This chip does a raw `fetch('/api/mcp/tool', ...)`, so mock `global.fetch` to return
`{error: 'gateway_policy_denied', gatewayErrorCode: 'mcp-invalid-actor', allowedActor: 'real-agent-client-id'}`
with a 403 status, then assert the rendered message contains both the rogue actor id
(`rogue-agent-9f2a-not-allowlisted`, already shown today) AND `real-agent-client-id`.

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.confusedDeputy.test.js`
Expected: FAIL — the current message doesn't reference `data.allowedActor` at all.

- [ ] **Step 8: Update the `atk_confused_deputy` block**

In `demo_api_ui/src/components/AIAgent.js`, modify the message construction inside the
`atk_confused_deputy` block (currently lines 6886-6891):

```javascript
                              addMessage(
                                "token-event",
                                denied
                                  ? `⛔ PingOne Authorize DENY (HTTP ${r.status}) — ${data.error || data.gatewayErrorCode || "mcp-invalid-actor"}\nHasValidActorChain → false: actor "${rogue}" is not among the registered actors (delegation is bound to the AI Agent, not a may_act allowlist).`
                                  : `❌ Expected a DENY for a rogue actor chain, but the call returned HTTP ${r.status}.`,
                                null,
                              );
```

Replace with:

```javascript
                              const allowedActorLine = data?.allowedActor
                                ? `\nAllowed actor: "${data.allowedActor}"`
                                : "";
                              addMessage(
                                "token-event",
                                denied
                                  ? `⛔ PingOne Authorize DENY (HTTP ${r.status}) — ${data.error || data.gatewayErrorCode || "mcp-invalid-actor"}\nTried: actor "${rogue}"${allowedActorLine}\nHasValidActorChain → false: actor "${rogue}" is not among the registered actors (delegation is bound to the AI Agent, not a may_act allowlist).`
                                  : `❌ Expected a DENY for a rogue actor chain, but the call returned HTTP ${r.status}.`,
                                null,
                              );
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.confusedDeputy.test.js`
Expected: PASS.

- [ ] **Step 10: Run regression-guard's build gate, then commit both files**

```bash
cd demo_api_server
git add services/mcpToolPipeline.js src/__tests__/mcpToolPipeline.confusedDeputy.test.js
git commit -m "feat(mcp-tool-pipeline): expose the real allowed actor on confused-deputy denials"

cd ../demo_api_ui
git add src/components/AIAgent.js src/components/__tests__/AIAgent.confusedDeputy.test.js
git commit -m "fix(ui): show tried vs. allowed actor on the confused-deputy attack chip"
```

---

## Task 3: HITL replay — surface the real rejection reason (backend + UI)

**Files:**
- Modify: `demo_api_server/services/mcpToolAuthorizationService.js` (lines ~216-234 and ~404-420)
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `atk_hitl_replay` block, lines 6954-7011)
- Create: `demo_api_server/src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js`
- Create: `demo_api_ui/src/components/__tests__/AIAgent.hitlReplay.test.js`

**Interfaces:**
- Produces: the 428 `mcp_hitl_required` response body gains an optional
  `receiptRejectionReason: string | null` field, present only when a presented HITL receipt was
  actually rejected by `verifyHitlReceipt` (not when no receipt was presented at all).

- [ ] **Step 1: Write the failing backend test**

Read `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js` in full first — copy its
`jest.mock(...)` boilerplate block verbatim (mocking `configStore`, `pingOneAuthorizeService`,
`simulatedAuthorizeService`, `hitlServiceClient`) into a new file.

Create `demo_api_server/src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js`:

```javascript
/**
 * @file mcpToolAuthorizationService.hitlReplay.test.js
 * Covers the receiptRejectionReason field added to the 428 mcp_hitl_required
 * body — see docs/superpowers/plans/2026-07-13-remaining-tried-vs-allowed.md Task 3.
 */

// Copy the exact jest.mock() blocks from mcpToolAuthorizationService.test.js verbatim
// (configStore, pingOneAuthorizeService, simulatedAuthorizeService, hitlServiceClient),
// then:

const hitlServiceClient = require('../../services/hitlServiceClient');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const { evaluateMcpFirstToolGate } = require('../../services/mcpToolAuthorizationService');

describe('428 mcp_hitl_required — receiptRejectionReason', () => {
  it('includes receiptRejectionReason when a presented receipt is bound to a different tool', async () => {
    hitlServiceClient.getChallengeStatus.mockResolvedValue({ status: 'approved', tool: 'create_transfer' });
    hitlServiceClient.verifyHitlReceipt.mockReturnValue({
      ok: false,
      message: 'HITL challenge belongs to a different tool',
    });
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
      hitlRequired: true,
      decisionId: 'd1',
    });
    // Use baseReq / whatever request-builder mcpToolAuthorizationService.test.js's existing
    // tests use (read that file for the exact shape), with hitlChallengeId set so the
    // receipt-verification branch runs.
    const result = await evaluateMcpFirstToolGate({ /* baseReq shape, + hitlChallengeId: 'c1' */ });
    expect(result.block.status).toBe(428);
    expect(result.block.body.receiptRejectionReason).toBe('HITL challenge belongs to a different tool');
  });

  it('omits receiptRejectionReason when no receipt was presented at all', async () => {
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
      hitlRequired: true,
      decisionId: 'd2',
    });
    const result = await evaluateMcpFirstToolGate({ /* baseReq shape, no hitlChallengeId */ });
    expect(result.block.status).toBe(428);
    expect(result.block.body.receiptRejectionReason).toBeUndefined();
  });
});
```

Adjust the exact request object shape to match whatever `baseReq`/request-builder
`mcpToolAuthorizationService.test.js`'s own existing tests use (read that file first, per Step 1's
instruction) — do not guess the shape independently.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js`
Expected: FAIL — `receiptRejectionReason` is `undefined` in the first test (should be the message string).

- [ ] **Step 3: Hoist and thread the rejection message**

In `demo_api_server/services/mcpToolAuthorizationService.js`, inside `evaluateMcpFirstToolGate`:

1. Change (currently line 216):
```javascript
  let hitlApproved = false;
```
to:
```javascript
  let hitlApproved = false;
  let hitlRejectionMessage = null;
```

2. Change (currently lines 229-234):
```javascript
      hitlApproved = verification.ok === true;
      if (!hitlApproved) {
        console.warn(
          `[MCP Authorize] HITL receipt rejected for tool=${tool} reason=${verification.message} — re-challenging`,
        );
      }
```
to:
```javascript
      hitlApproved = verification.ok === true;
      if (!hitlApproved) {
        hitlRejectionMessage = verification.message || null;
        console.warn(
          `[MCP Authorize] HITL receipt rejected for tool=${tool} reason=${verification.message} — re-challenging`,
        );
      }
```

3. Change the 428 body construction (currently lines 404-420, inside `mapLivePingOneResult`'s `if (r.hitlRequired)` branch):
```javascript
    if (r.hitlRequired) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_hitl_required',
            error_description:
              'PingOne Authorize requires human approval before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            ...autoDisabled,
          },
        },
      };
    }
```
to:
```javascript
    if (r.hitlRequired) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_hitl_required',
            error_description:
              'PingOne Authorize requires human approval before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            ...autoDisabled,
            ...(hitlRejectionMessage ? { receiptRejectionReason: hitlRejectionMessage } : {}),
          },
        },
      };
    }
```

`mapLivePingOneResult` is a nested closure inside `evaluateMcpFirstToolGate` (confirmed: declared
inside the function body, called synchronously later in the same function), so
`hitlRejectionMessage` is in scope via closure exactly the way `hitlApproved` already is (used
directly at the existing `if (r.hitlRequired && hitlApproved)` branch a few lines above this one).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js`
Expected: Both tests PASS.

- [ ] **Step 5: Run the existing test file to check for regressions**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolAuthorizationService.test.js`
Expected: All pass, including the existing test at (previously) lines 456-461
(`'fails closed (hitlApproved=false) when verifyHitlReceipt rejects'`).

- [ ] **Step 6: Write the failing UI test**

Create `demo_api_ui/src/components/__tests__/AIAgent.hitlReplay.test.js`, copying
`AIAgent.wrongAudience.test.js`'s boilerplate. This chip's flow does 4 sequential `fetch` calls
(`get_my_accounts`, `create_transfer`, the approve endpoint, `create_withdrawal`) — mock
`global.fetch` with a sequence of responses (2 accounts, a transfer that returns a `challengeId`,
a successful approve, then a 428 `create_withdrawal` response with
`{error: 'mcp_hitl_required', receiptRejectionReason: 'HITL challenge belongs to a different tool'}`).
Assert the rendered message includes the real `receiptRejectionReason` text, not just the generic
"re-challenged" fallback.

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.hitlReplay.test.js`
Expected: FAIL — the current message never references `rb.receiptRejectionReason`.

- [ ] **Step 8: Update the `atk_hitl_replay` block**

In `demo_api_ui/src/components/AIAgent.js`, modify the message construction (currently lines 6992-7000):

```javascript
                              addMessage(
                                "token-event",
                                [
                                  `♻ Approved a consent receipt for create_transfer (challenge ${String(challengeId).slice(0, 8)}…).`,
                                  "Replaying that SAME receipt on a different tool (create_withdrawal):",
                                  blocked
                                    ? `⛔ Blocked (HTTP ${replay.status} · ${rb.error || rb.gatewayErrorCode || "re-challenged"}) — the receipt is bound to the tool it approved; reuse is re-challenged, never honored.`
                                    : `❌ Expected the replay to be blocked, but it returned HTTP ${replay.status}.`,
                                ].join("\n"),
                                null,
                              );
```

Replace with:

```javascript
                              addMessage(
                                "token-event",
                                [
                                  `♻ Approved a consent receipt for create_transfer (challenge ${String(challengeId).slice(0, 8)}…).`,
                                  "Replaying that SAME receipt on a different tool (create_withdrawal):",
                                  blocked
                                    ? `⛔ Blocked (HTTP ${replay.status} · ${rb.error || rb.gatewayErrorCode || "re-challenged"})${rb.receiptRejectionReason ? `\nReason: ${rb.receiptRejectionReason}` : ""} — the receipt is bound to the tool it approved; reuse is re-challenged, never honored.`
                                    : `❌ Expected the replay to be blocked, but it returned HTTP ${replay.status}.`,
                                ].join("\n"),
                                null,
                              );
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.hitlReplay.test.js`
Expected: PASS.

- [ ] **Step 10: Run regression-guard's build gate, then commit both files**

```bash
cd demo_api_server
git add services/mcpToolAuthorizationService.js src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js
git commit -m "feat(mcp-authz): surface the real HITL receipt rejection reason on 428 responses"

cd ../demo_api_ui
git add src/components/AIAgent.js src/components/__tests__/AIAgent.hitlReplay.test.js
git commit -m "fix(ui): show the real rejection reason on the HITL-replay attack chip"
```

---

## Task 4: Cross-vertical deny — show tools allowed in the current vertical (UI only)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `showcase === "authz_deny"` block, lines 6832-6865)
- Create: `demo_api_ui/src/components/__tests__/AIAgent.crossVerticalDeny.test.js`

**Interfaces:**
- Consumes: `toolPermissions` (`AIAgent.js:1298-1302`, already in scope in the same component,
  keyed by tool name, populated from the real `POST /api/demo-agent/tools` discovery response).

- [ ] **Step 1: Write the failing UI test**

Create `demo_api_ui/src/components/__tests__/AIAgent.crossVerticalDeny.test.js`, copying
`AIAgent.wrongAudience.test.js`'s boilerplate. Since `toolPermissions` is derived from
`fetchAgentTools`'s response (mocked in the reference file's `demoAgentService` mock block as
`fetchAgentTools: jest.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true })`),
override that mock per-test to resolve `{ availableTools: [{name: 'get_my_accounts', permitted: true}, {name: 'get_my_transactions', permitted: true}] }`, then trigger the `authz_deny` showcase (mock `callMcpTool` to reject/deny for the out-of-vertical tool), and assert the rendered message lists `get_my_accounts`/`get_my_transactions` as allowed tools.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.crossVerticalDeny.test.js`
Expected: FAIL — the current message never lists any allowed tools.

- [ ] **Step 3: Update the `authz_deny` block**

In `demo_api_ui/src/components/AIAgent.js`, modify the message construction (currently lines 6841-6847):

```javascript
                              addMessage(
                                "token-event",
                                denied
                                  ? `⛔ PingOne Authorize DENY — '${tool}' is not permitted in this vertical (AllowedVertical).`
                                  : `❌ Expected a DENY for '${tool}', but the call returned a result.`,
                                null,
                              );
```

Replace with:

```javascript
                              const allowedToolNames = Object.keys(toolPermissions).filter(
                                (name) => toolPermissions[name]?.permitted !== false,
                              );
                              const allowedToolsLine = allowedToolNames.length
                                ? `\nAllowed tools in your current vertical: [${allowedToolNames.join(", ")}]`
                                : "";
                              addMessage(
                                "token-event",
                                denied
                                  ? `⛔ PingOne Authorize DENY — '${tool}' is not permitted in this vertical (AllowedVertical).\nTried: '${tool}'${allowedToolsLine}`
                                  : `❌ Expected a DENY for '${tool}', but the call returned a result.`,
                                null,
                              );
```

`toolPermissions` is already in scope (defined at the top of the same `BankingAgent` component
function, `AIAgent.js:1298-1302`) — no new state, no new fetch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.crossVerticalDeny.test.js`
Expected: PASS.

- [ ] **Step 5: Run regression-guard's build gate, then commit**

```bash
cd demo_api_ui
git add src/components/AIAgent.js src/components/__tests__/AIAgent.crossVerticalDeny.test.js
git commit -m "fix(ui): show which tools are allowed in the current vertical on the cross-vertical-deny chip"
```

---

## Final verification

- [ ] Run all 4 new backend test files: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolPipeline.confusedDeputy.test.js src/__tests__/mcpToolAuthorizationService.hitlReplay.test.js`
- [ ] Run the affected backend regression files: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/mcpToolPipeline.characterization.test.js src/__tests__/mcpToolAuthorizationService.test.js`
- [ ] Run all new + affected UI test files: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongScope.test.js src/components/__tests__/AIAgent.confusedDeputy.test.js src/components/__tests__/AIAgent.hitlReplay.test.js src/components/__tests__/AIAgent.crossVerticalDeny.test.js src/__tests__/BankingAgent.integration.test.js`
- [ ] Manually exercise all 4 chips in the running demo and confirm each outcome message shows both the tried and allowed values.
