# Fix Wrong-Audience Attack Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Wrong Audience" attack chip actually exercise real RFC 8693/8707 audience
validation (it currently silently no-ops) by wiring it to the already-real `wrong-aud` attack
simulator, and show both the audience that was tried and the audience that is actually allowed —
both sourced from real, already-computed backend values.

**Architecture:** `AIAgent.js`'s `test_wrong_audience` case switches from a broken direct
`/api/mcp/tool` call to `POST /api/demo/attack-sim/run` with `{sim: "wrong-aud"}`, which already
runs a real token exchange + gateway call via `attackSimulatorService.js`'s `_runWrongAud`. That
function gains two new structured response fields (`triedAudience`, `allowedAudience`) exposing
values it already computes internally, so the UI can render both sides without inventing anything.

**Tech Stack:** Node.js/Express (BFF), React (UI), Jest (backend tests), Vitest (UI tests).

## Global Constraints

- Zero changes to `_runWrongAud`'s actual attack mechanics (the token exchange / gateway call
  logic) — this is a data-exposure + UI-rewiring fix, not new attack logic.
- `triedAudience`/`allowedAudience` are added only on the 3 return paths where both `wrongAud` and
  `gatewayAud` are real, known values (exchange-failed, unexpected-permit, gateway-deny) — NOT on
  the 2 early-return config-error paths (`gateway_not_configured`, `wrong_aud_not_configured`),
  where one side is genuinely absent.
- The UI message must reflect the REAL `errorCode`/`status`/`reason` from the response — do not
  collapse every outcome into a binary rejected/not-rejected; the simulator can return 5 distinct
  outcomes (`invalid_aud` deny, `unexpected_permit`, `gateway_not_configured`,
  `wrong_aud_not_configured`, `exchange_failed`) and each must read honestly.
- `ff_use_cases_launcher` defaults to `'true'` — no feature-flag handling needed in this fix.

---

## Task 1: Backend — expose `triedAudience`/`allowedAudience` on `_runWrongAud`

**Files:**
- Modify: `demo_api_server/services/attackSimulatorService.js` (function `_runWrongAud`, lines 452-556)
- Create: `demo_api_server/src/__tests__/attackSimulator.wrongAudFields.test.js`

**Interfaces:**
- Produces: `_runWrongAud`'s return object gains two new optional fields on 3 of its 5 return
  paths: `triedAudience: string` (the `wrongAud` value it exchanged for) and
  `allowedAudience: string` (the `gatewayAud` value the gateway actually expects). Consumed by
  Task 2's UI change via the same `POST /api/demo/attack-sim/run` response.

- [ ] **Step 1: Write the failing structural test**

Create `demo_api_server/src/__tests__/attackSimulator.wrongAudFields.test.js`:

```javascript
'use strict';
/**
 * Structural (mocked) coverage of _runWrongAud's new triedAudience/allowedAudience
 * fields — no live PingOne/gateway credentials needed. Complements the existing
 * ATTACK_SIM_REAL_API-gated test in attackSimulator.test.js, which only runs
 * against a live stack.
 */

const mockPerformTokenExchange = jest.fn();
const mockCallToolViaGateway = jest.fn();

jest.mock('../../services/oauthService', () => ({
  performTokenExchange: (...args) => mockPerformTokenExchange(...args),
}));

jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: (...args) => mockCallToolViaGateway(...args),
  getMcpGatewayHttpUrl: () => 'http://mcp-gateway:3005',
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'pingone_resource_mcp_gateway_uri') return 'https://mcp-gateway.example.com';
    if (key === 'pingone_resource_mcp_server_uri') return 'https://mcp-server.example.com';
    return null;
  }),
}));

const { runAttackSim } = require('../../services/attackSimulatorService');

// A syntactically well-formed (unsigned) JWT so decodeJwtClaims can base64-decode
// its payload — the sim never verifies the signature, only presents it to the
// (mocked) gateway.
function fakeJwt(aud) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud, sub: 'test-user' })).toString('base64url');
  return `${header}.${payload}.`;
}

function makeReq() {
  return { session: { oauthTokens: { accessToken: fakeJwt('https://original-aud.example.com') } } };
}

beforeEach(() => {
  mockPerformTokenExchange.mockReset();
  mockCallToolViaGateway.mockReset();
});

describe('_runWrongAud — triedAudience/allowedAudience fields', () => {
  test('gateway-deny path includes both real audience values', async () => {
    mockPerformTokenExchange.mockResolvedValue(fakeJwt('https://mcp-server.example.com'));
    mockCallToolViaGateway.mockRejectedValue({
      code: 'GATEWAY_AUDIENCE_MISMATCH',
      httpStatus: 401,
      message: 'aud mismatch',
    });

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('invalid_aud');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });

  test('unexpected-permit path includes both real audience values', async () => {
    mockPerformTokenExchange.mockResolvedValue(fakeJwt('https://mcp-server.example.com'));
    mockCallToolViaGateway.mockResolvedValue({ ok: true });

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('unexpected_permit');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });

  test('exchange-failed path includes both real audience values', async () => {
    mockPerformTokenExchange.mockRejectedValue(
      Object.assign(new Error('exchange rejected'), { pingoneError: 'invalid_target' }),
    );

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('invalid_target');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/attackSimulator.wrongAudFields.test.js`
Expected: FAIL — `expect(result.triedAudience).toBe(...)` fails because `triedAudience` is `undefined` (the field doesn't exist on the return object yet).

If the test fails for a DIFFERENT reason (e.g. `decodeJwtClaims` throwing on the fake JWT, or the mocked `callToolViaGateway`/`performTokeneExchange` not being called with the shape `_runWrongAud` expects), read `_runWrongAud` (lines 452-556, already fully quoted in this repo) and `decodeJwt`'s implementation (search `agentMcpTokenService.js` or wherever `decodeJwt` — not `decodeJwtClaims` — is defined/imported from) to adjust the mock's fake JWT shape or mock call signatures until the test fails for the RIGHT reason (missing fields), not a setup error. Do not change `attackSimulatorService.js` to make setup errors go away.

- [ ] **Step 3: Add the two fields to `_runWrongAud`'s three applicable return paths**

In `demo_api_server/services/attackSimulatorService.js`, inside `_runWrongAud` (lines 452-556):

1. The exchange-failed return (currently, inside the `catch (err)` block around line 495):
```javascript
    return { sim, useCaseId, status: 502, errorCode, reason, tokenChainEvents };
```
becomes:
```javascript
    return {
      sim, useCaseId, status: 502, errorCode, reason, tokenChainEvents,
      triedAudience: wrongAud, allowedAudience: gatewayAud,
    };
```

2. The unexpected-permit return (currently around lines 535-542):
```javascript
    return {
      sim, useCaseId,
      status: 200,
      errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — audience validation may not be active',
      tokenChainEvents,
    };
```
becomes:
```javascript
    return {
      sim, useCaseId,
      status: 200,
      errorCode: 'unexpected_permit',
      reason: 'Gateway permitted the call — audience validation may not be active',
      tokenChainEvents,
      triedAudience: wrongAud, allowedAudience: gatewayAud,
    };
```

3. The gateway-deny return (currently around line 556):
```javascript
    return { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
```
becomes:
```javascript
    return {
      sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents,
      triedAudience: wrongAud, allowedAudience: gatewayAud,
    };
```

Do NOT modify the two early-return `503` paths (`gateway_not_configured`, `wrong_aud_not_configured`) — leave them exactly as they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/attackSimulator.wrongAudFields.test.js`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run the existing attackSimulator test file to check for regressions**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/attackSimulator.test.js`
Expected: The structural tests (the ones not gated behind `ATTACK_SIM_REAL_API`) still pass; the `describeIf` real-API blocks remain skipped (no `ATTACK_SIM_REAL_API` env var set).

- [ ] **Step 6: Commit**

```bash
cd demo_api_server
git add services/attackSimulatorService.js src/__tests__/attackSimulator.wrongAudFields.test.js
git commit -m "feat(attack-sim): expose tried/allowed audience on the wrong-aud sim result"
```

---

## Task 2: UI — wire the chip to the real simulator and show both audience values

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `test_wrong_audience` case, lines 3007-3076)
- Modify: `demo_api_ui/src/__tests__/BankingAgent.integration.test.js` (remove the stale
  placeholder `describe('test_wrong_audience handler', ...)` block, lines 272-296 — these 4 tests
  are `expect(true).toBe(true)` placeholders describing the OLD broken `/api/mcp/tool` +
  `_testAudience` approach being replaced; keeping them would document behavior that no longer
  exists)
- Create: `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js`

**Interfaces:**
- Consumes: `POST /api/demo/attack-sim/run` with body `{sim: "wrong-aud"}`, response shape from
  Task 1: `{sim, useCaseId, status, errorCode, reason, tokenChainEvents, triedAudience?,
  allowedAudience?}`.

- [ ] **Step 1: Write the failing UI test**

Create `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js`, modeled on the same
mocking pattern as `demo_api_ui/src/components/__tests__/AIAgent.aguiError.test.js` (same context
mocks), but this test drives the `test_wrong_audience` action directly rather than injecting
`useAgentState` output — read `AIAgent.aguiError.test.js` in full first for the exact mock-block
boilerplate to copy verbatim (all the `vi.mock(...)` calls for `IndustryBrandingContext`,
`EducationUIContext`, `TokenChainContext`, `AgentUiModeContext`, `SessionTokenContext`,
`demoAgentNlService`, `demoAgentService`, `configService`, `agentAccessConsent`,
`agentToolSteps`, `react-toastify`, `appToast`, `BankingAgent.css`, `useAgentState`,
`useAgentRun`), then additionally mock `global.fetch` to intercept the
`/api/demo/attack-sim/run` call and return a controlled JSON body. Since `test_wrong_audience` is
invoked via the same `runAction`/chip-click mechanism as other test chips (not exposed as a plain
prop), locate how an existing test in this repo triggers a specific `runAction` case by chip id
(search `demo_api_ui/src/components/__tests__/` and `demo_api_ui/src/__tests__/` for a test that
clicks or dispatches `test_wrong_scope`/`test_wrong_audience` on a rendered `AIAgent`/`BankingAgent`
component) and follow that exact triggering mechanism — do not invent a new one. If no such
end-to-end trigger pattern exists anywhere in the test suite (the `BankingAgent.integration.test.js`
placeholders being removed in this task suggest one may not), write this test as a more direct
unit-level test of the response-message-building behavior instead: extract enough of the
`test_wrong_audience` case's message-building logic to test the mapping from a given `simRes`
shape to the rendered message content, OR — if `runAction` is only reachable through full
component interaction and no simpler seam exists — escalate this specific question (BLOCKED or
NEEDS_CONTEXT) rather than guessing at test architecture for a case with no existing precedent.

At minimum, assert: (a) the fetch call target is `/api/demo/attack-sim/run` with body
`{sim: "wrong-aud"}`, not `/api/mcp/tool`; (b) given a mocked `invalid_aud` deny response with
`triedAudience`/`allowedAudience` set, the resulting chat message contains both audience values;
(c) given a mocked `unexpected_permit` response, the message reflects that outcome distinctly
(not conflated with the deny case).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongAudience.test.js`
Expected: FAIL — the current handler still calls `/api/mcp/tool`, not
`/api/demo/attack-sim/run`, and doesn't reference `triedAudience`/`allowedAudience`.

- [ ] **Step 3: Rewrite the `test_wrong_audience` case**

In `demo_api_ui/src/components/AIAgent.js`, replace the entire `case "test_wrong_audience":`
block (lines 3007-3076) with:

```javascript
        case "test_wrong_audience": {
          // Calls the real wrong-audience attack simulator (attackSimulatorService.js's
          // _runWrongAud, exposed at POST /api/demo/attack-sim/run) — a real RFC 8693 token
          // exchange to a genuinely different, real PingOne-registered audience, then a real
          // gateway call expecting a genuine audience-mismatch denial. Both the audience that
          // was tried and the audience the gateway actually expects come back as real,
          // server-computed values (triedAudience / allowedAudience) — never fabricated
          // client-side.
          // RFC 8693 §2.1 + RFC 8707 — token exchange requires the `audience` to match a
          // resource server the AS is authorised to issue for.
          toast.update(toastId, {
            render: "⚠️ Testing wrong audience on MCP token exchange…",
          });
          let simRes;
          try {
            const apiBase = process.env.REACT_APP_API_URL || "";
            const r = await fetch(`${apiBase}/api/demo/attack-sim/run`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              _silent: true,
              body: JSON.stringify({ sim: "wrong-aud" }),
            });
            simRes = await r.json();
            simRes._httpStatus = r.status;
          } catch (simErr) {
            simRes = { errorCode: "request_failed", reason: simErr.message };
          }
          const audienceLines =
            simRes?.triedAudience && simRes?.allowedAudience
              ? [
                  `Tried: aud="${simRes.triedAudience}"`,
                  `Allowed (gateway expects): aud="${simRes.allowedAudience}"`,
                  "",
                ]
              : [];
          let audOutcome;
          if (simRes?.errorCode === "invalid_aud") {
            audOutcome = `✅ Gateway correctly rejected (${simRes.status} ${simRes.errorCode}): ${simRes.reason}`;
          } else if (simRes?.errorCode === "unexpected_permit") {
            audOutcome = `❌ Gateway permitted a wrong-audience token — audience validation may not be active: ${simRes.reason}`;
          } else if (
            simRes?.errorCode === "gateway_not_configured" ||
            simRes?.errorCode === "wrong_aud_not_configured"
          ) {
            audOutcome = `ℹ️ Simulator not fully configured: ${simRes.reason}`;
          } else {
            audOutcome = `⚠️ Simulator error (${simRes?.status ?? simRes?._httpStatus ?? "?"} ${simRes?.errorCode || "unknown"}): ${simRes?.reason || "no reason given"}`;
          }
          addMessage(
            "token-event",
            [
              "⚠️ Authorization Test: Wrong Audience (RFC 8693 §2.1 · RFC 8707)",
              "",
              ...audienceLines,
              audOutcome,
              "",
              "RFC 8693 §2.1 — The `audience` parameter in a token exchange request identifies which",
              "   resource server the resulting token is valid for. The AS verifies it against its policy.",
              "RFC 8707 — Resource Indicators bind access tokens to specific resource URIs.",
              "   A token issued for one resource MUST be rejected by a different resource server.",
              "   The `aud` claim in the MCP token must exactly match the MCP server's registered audience.",
              "",
              "Open Token Chain 🪟 → MCP access token → `aud` claim to see the audience after exchange.",
            ].join("\n"),
            actionId,
          );
          if (simRes?.tokenChainEvents?.length) {
            tokenChain?.setTokenEvents(actionId, simRes.tokenChainEvents);
          }
          toast.update(toastId, {
            render:
              simRes?.errorCode === "invalid_aud"
                ? "✅ Audience rejection confirmed"
                : "ℹ️ Audience test complete",
            type: "info",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
```

- [ ] **Step 4: Remove the stale placeholder tests**

In `demo_api_ui/src/__tests__/BankingAgent.integration.test.js`, delete the entire
`describe('test_wrong_audience handler', ...)` block (lines 272-296, the 4 `expect(true).toBe(true)`
placeholder tests that describe the old `/api/mcp/tool` + `_testAudience` approach).

- [ ] **Step 5: Run tests to verify Step 3's new test passes and Step 4 didn't break anything**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongAudience.test.js src/__tests__/BankingAgent.integration.test.js`
Expected: The new test file passes; `BankingAgent.integration.test.js` still passes (with 4 fewer
placeholder tests than before).

- [ ] **Step 6: Run regression-guard's build gate**

Per this repo's CLAUDE.md, invoke the regression-guard skill for this change (it touches
`demo_api_ui`/banking UI) and follow its build-gate step before considering this task done.

- [ ] **Step 7: Commit**

```bash
cd demo_api_ui
git add src/components/AIAgent.js src/__tests__/BankingAgent.integration.test.js src/components/__tests__/AIAgent.wrongAudience.test.js
git commit -m "fix(ui): wire wrong-audience chip to the real attack simulator, show tried/allowed audience"
```

---

## Final verification

- [ ] Run `demo_api_server`'s full relevant test slice once more:
  `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/attackSimulator.wrongAudFields.test.js src/__tests__/attackSimulator.test.js`
- [ ] Run `demo_api_ui`'s full relevant test slice once more:
  `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.wrongAudience.test.js src/__tests__/BankingAgent.integration.test.js`
- [ ] Manually exercise the "Wrong Audience" chip in the running demo and confirm the chat message
  shows both the tried audience and the gateway's actually-expected audience, sourced from a real
  denial (not the old always-succeeds behavior).
