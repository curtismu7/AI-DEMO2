# BFF-to-Agent Correlation ID Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread the BFF's request-scoped `correlationId` onto the outgoing HTTP call that starts an agent run, so `langchain_agent`'s new hop emitter (sibling plan `2026-08-16-prompt-flow-agent-emitter.md`) has a correlation ID to attach to every `agent.step` hop.

**Architecture:** `demo_api_server/services/aguiSseProxy.js:proxyAgentSse()` already builds a JSON body (`message`, `session_id`, `auth_token`, `run_id`, `vertical_flavor`) POSTed to the agent's `/run` endpoint. This plan adds one more field, `correlation_id`, read from the BFF's existing `AsyncLocalStorage`-backed `getCorrelationId()` helper (`demo_api_server/utils/correlationContext.js`) — the same one `middleware/correlationId.js` already populates for every request. No new transport, no new header — just one more field on an existing request body, symmetric with the fields already there.

**Tech Stack:** Node >= 22, CommonJS, Jest 29.7 + supertest (per `demo_api_server/CLAUDE.md`)

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md (§1, "BFF → Agent" bullet)

## Global Constraints

- `CI=true` is mandatory when running this service's jest suite — without it supertest flakes and a green run proves nothing (`demo_api_server/CLAUDE.md`).
- Error responses use `{ error }`, never `{ message }` — not touched by this plan, but any new code in this file must not violate it if extended later.
- This plan does not modify the agent-side receiver — `langchain_agent`'s sibling plan already threads `correlation_id` from the incoming request body through to the hop emitter; this plan only guarantees the field is present in the outgoing body.

---

### Task 1: Thread correlationId into the agent /run request body

**Files:**
- Modify: `demo_api_server/services/aguiSseProxy.js:78-111` (the `proxyAgentSse()` function)
- Test: `demo_api_server/tests/aguiSseProxy.test.js` (new file — no existing test file for this module; confirmed via `find demo_api_server -iname '*aguiSseProxy*'` returning only the source file)

**Interfaces:**
- Consumes: `getCorrelationId()` from `demo_api_server/utils/correlationContext.js` (existing, unmodified) — returns the string correlation ID for the current request's `AsyncLocalStorage` scope, or `undefined` if none is in scope (e.g. a call made outside `runWithCorrelation()`).
- Produces: `proxyAgentSse()`'s outgoing JSON body now includes `correlation_id: <string|undefined>` alongside the existing `message`/`session_id`/`auth_token`/`run_id`/`vertical_flavor` fields. `JSON.stringify` drops `undefined` values, so when no correlation ID is in scope the field is simply absent from the body (matches the existing fire-and-forget, correlation-ID-optional pattern used by `transactionHop.ts`/`transactionHop.js` elsewhere in this codebase).

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/aguiSseProxy.test.js`:

```js
'use strict';

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: {
      resolve: jest.fn(() => ({ agent: { systemPromptFlavor: null } })),
      activeId: jest.fn(() => 'super-sports'),
    },
  },
}));

const http = require('http');
const { runWithCorrelation } = require('../utils/correlationContext');
const { proxyAgentSse } = require('../services/aguiSseProxy');

describe('proxyAgentSse', () => {
  let capturedBody;
  let httpRequestSpy;

  beforeEach(() => {
    capturedBody = null;
    httpRequestSpy = jest.spyOn(http, 'request').mockImplementation((_options, _callback) => {
      return {
        on: jest.fn(),
        setTimeout: jest.fn(),
        write: jest.fn((body) => {
          capturedBody = JSON.parse(body);
        }),
        end: jest.fn(),
      };
    });
  });

  afterEach(() => {
    httpRequestSpy.mockRestore();
  });

  function fakeBrowserRes() {
    return { write: jest.fn(), end: jest.fn() };
  }

  it('includes correlation_id in the agent request body when one is in scope', () => {
    runWithCorrelation('cid_test_12345', () => {
      proxyAgentSse({
        browserRes: fakeBrowserRes(),
        runId: 'run_1',
        sessionId: 'sess_1',
        message: 'hello',
        authToken: 'tok_1',
        tokenChainEvents: [],
        vertical: 'super-sports',
      });
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.correlation_id).toBe('cid_test_12345');
  });

  it('omits correlation_id from the agent request body when none is in scope', () => {
    proxyAgentSse({
      browserRes: fakeBrowserRes(),
      runId: 'run_2',
      sessionId: 'sess_2',
      message: 'hello',
      authToken: 'tok_2',
      tokenChainEvents: [],
      vertical: 'super-sports',
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.correlation_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/aguiSseProxy.test.js --forceExit`
Expected: FAIL — first test's `expect(capturedBody.correlation_id).toBe('cid_test_12345')` fails because `capturedBody.correlation_id` is `undefined` (the field doesn't exist yet in `requestBody`).

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/aguiSseProxy.js`, add the import near the top of the file (after the existing `verticalManifest` require, line 2):

```js
const { getCorrelationId } = require('../utils/correlationContext');
```

Then modify the `requestBody` construction (currently lines 104-111) from:

```js
  const requestBody = JSON.stringify({
    message,
    session_id: sessionId,
    auth_token: authToken,
    run_id: runId,
    vertical_flavor: verticalFlavor,
  });
```

to:

```js
  const requestBody = JSON.stringify({
    message,
    session_id: sessionId,
    auth_token: authToken,
    run_id: runId,
    vertical_flavor: verticalFlavor,
    correlation_id: getCorrelationId(),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/aguiSseProxy.test.js --forceExit`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full existing suite for this file's callers to confirm no regression**

Run: `cd demo_api_server && CI=true npx jest agentLangchainRunRoute --forceExit`
Expected: PASS (or "No tests found" if none exist for that route — either is fine; the goal is confirming this change didn't break an existing passing suite. If tests exist and fail for reasons unrelated to `correlation_id`, stop and investigate before continuing — do not paper over an unrelated failure.)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/aguiSseProxy.js demo_api_server/tests/aguiSseProxy.test.js
git commit -m "$(cat <<'EOF'
Thread BFF correlationId into agent /run request body

Gives the agent-side hop emitter (sibling prompt-flow plan) a
correlation ID to attach to every agent.step hop, closing the last
gap in the Agent -> LLM -> Gateway -> P1AZ -> Backend trace chain.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Self-Review

- **Spec coverage**: spec §1's "BFF → Agent" bullet ("thread correlationId into agent invocation ... at BFF, flows agent→LLM→gateway→P1AZ") is now fully covered — this was the one unclaimed piece after all 6 sibling plans were reviewed (confirmed by grepping all six plan files for `correlationId`/`websocket`/`Consumes:` — the agent-emitter plan explicitly deferred the BFF-side send, and no other plan claimed it).
- **Placeholder scan**: no TBD/TODO; both test cases and the implementation diff are complete, real code.
- **Type consistency**: `getCorrelationId()` is consumed exactly as exported by `demo_api_server/utils/correlationContext.js` (confirmed by reading that file directly — `module.exports = { runWithCorrelation, getCorrelationId, als }`). `correlation_id` (snake_case) matches the existing body's naming convention (`session_id`, `auth_token`, `run_id`, `vertical_flavor` are all snake_case — this BFF↔agent boundary is snake_case even though the rest of `demo_api_server` is camelCase; matched intentionally, not a typo).
- **Scope check**: single file, single task, independently testable and mergeable regardless of sibling-plan ordering — the field is additive and optional (undefined when no correlation ID is in scope), so this can land before, after, or independently of the agent-emitter plan.
