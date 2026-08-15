# MCP Annotations → P1AZ + Elicitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire MCP tool annotations (readOnly/destructive/idempotent) into every P1AZ decision context and add an inline elicitation consent flow for destructive tool calls, sitting alongside (not replacing) the existing HITL/CIBA path.

**Architecture:** The gateway derives tool annotations from its existing per-tool scope-enforcement data and adds three fields to every `McpToolCall` P1AZ request. P1AZ mock and real policy gain a new `ELICITATION` obligation class; when emitted, the gateway returns JSON-RPC error -32003 with a session-bound elicitation record. The downstream agent service (the actual MCP client calling the gateway) must handle -32003 by pausing its loop and emitting an `ELICITATION_REQUIRED` AG-UI event — modelled on the existing HITL interrupt pattern.

**Tech Stack:** TypeScript (demo_mcp_gateway), Node/CommonJS (demo_authz_server, demo_api_server), React 19 / JSX (demo_api_ui), Jest/vitest, existing HITL pub-sub pattern.

**Spec:** `docs/superpowers/specs/2026-08-14-mcp-annotations-elicitation-design.md`

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- All modals must use `DraggableModal`, never hand-rolled overlays or `window.confirm()`
- Stage explicitly with named files — never `git add -A`
- Node >= 22; TypeScript strict mode in demo_mcp_gateway
- HITL/CIBA path (-32002) must remain completely unchanged
- All gateway unit tests: `cd demo_mcp_gateway && npm test`
- All BFF tests: `cd demo_api_server && CI=true npm test -- --forceExit`
- UI build gate: `cd demo_api_ui && npm run test:unit && npm run build`
- Work in a git worktree — never edit main checkout directly

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_mcp_gateway/src/utils/toolAnnotations.ts` | Create | Load tool→annotation map from existing gateway scope data; export `getToolAnnotations()` |
| `demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts` | Modify | Add `ToolReadOnly`, `ToolDestructive`, `ToolIdempotent`, `ElicitationConfirmed` to `buildAuthorizeParameters` |
| `demo_mcp_gateway/src/auth/authorizeObligations.ts` | Modify | Add `'elicitation'` to `ObligationKind`; add `ELICITATION` keyword match |
| `demo_mcp_gateway/src/index.ts` | Modify | Elicitation store + -32003 handler + re-call validation + expiry sweep |
| `demo_authz_server/` (locate policy rule file) | Modify | Emit `ELICITATION` statement for destructive tools when `ElicitationConfirmed` absent |
| `demo_api_server/services/authorizeObligations.js` | Modify | Mirror the `'elicitation'` kind + `ELICITATION` keyword (drift prevention) |
| `demo_api_server/routes/agentRun.js` | Modify | Intercept `-32003` piped from agent service; store pending elicitation; add confirm/deny routes |
| `demo_api_ui/src/components/ElicitationModal.jsx` | Create | DraggableModal wrapping inline confirm/deny UI |
| `demo_api_ui/src/components/AgentView.jsx` (locate exact file) | Modify | Consume `ELICITATION_REQUIRED` SSE event; render ElicitationModal |

---

## Task 1: Locate gateway tool-annotation data and create `toolAnnotations.ts`

**Files:**
- Create: `demo_mcp_gateway/src/utils/toolAnnotations.ts`
- Create: `demo_mcp_gateway/src/utils/__tests__/toolAnnotations.test.ts`

**Context — read this first:**
The gateway enforces scopes locally via a "Rule 3 fallback" without calling P1AZ. Find where this lives:
```bash
grep -r "Rule 3\|localScope\|scopeTopology\|requiredScopes\|toolScope" \
  demo_mcp_gateway/src --include="*.ts" -l
```
That file contains the per-tool → required-scopes mapping. Use it as the data source for annotations. If it's an imported JSON, use the same JSON. If it's computed, replicate the lookup logic.

**Interfaces:**
- Produces: `getToolAnnotations(toolName: string): ToolAnnotation` where  
  `ToolAnnotation = { readOnly: boolean; destructive: boolean; idempotent: boolean }`  
  — used by Task 2

- [ ] **Step 1: Read the Rule 3 local fallback code**

```bash
grep -r "Rule 3\|localScope\|scopeCheck\|requiredScopes" \
  demo_mcp_gateway/src --include="*.ts" -rn | head -30
```

Identify which file and which data structure maps tool names to required scopes. Note the file path.

- [ ] **Step 2: Write the failing test**

```typescript
// demo_mcp_gateway/src/utils/__tests__/toolAnnotations.test.ts
import { getToolAnnotations } from '../toolAnnotations';

describe('getToolAnnotations', () => {
  it('marks a read-only tool correctly', () => {
    // Use a tool name you confirmed requires only "read" scope in Step 1
    const ann = getToolAnnotations('get_my_accounts');
    expect(ann.readOnly).toBe(true);
    expect(ann.destructive).toBe(false);
    expect(ann.idempotent).toBe(true);
  });

  it('marks a write tool as destructive', () => {
    // Use a tool name you confirmed requires "write" scope in Step 1
    const ann = getToolAnnotations('create_withdrawal');
    expect(ann.readOnly).toBe(false);
    expect(ann.destructive).toBe(true);
    expect(ann.idempotent).toBe(false);
  });

  it('returns false/false for unknown tools', () => {
    const ann = getToolAnnotations('nonexistent_tool');
    expect(ann.readOnly).toBe(false);
    expect(ann.destructive).toBe(false);
    expect(ann.idempotent).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=toolAnnotations
```
Expected: FAIL — `getToolAnnotations` not found.

- [ ] **Step 4: Implement `toolAnnotations.ts`**

```typescript
// demo_mcp_gateway/src/utils/toolAnnotations.ts
// Replace TOOL_SCOPE_MAP with the actual import/data from Step 1.
// Shape: Record<string, { requiredScopes: string[] }> or similar.

import { TOOL_SCOPE_MAP } from '<path-found-in-step-1>';

export interface ToolAnnotation {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
}

export function getToolAnnotations(toolName: string): ToolAnnotation {
  const entry = TOOL_SCOPE_MAP[toolName];
  if (!entry) {
    return { readOnly: false, destructive: false, idempotent: false };
  }
  const scopes: string[] = entry.requiredScopes ?? entry.scopes ?? [];
  const requiresWrite = scopes.some(s => s === 'write' || s.endsWith(':write'));
  const readOnly = !requiresWrite;
  return {
    readOnly,
    destructive: requiresWrite,
    idempotent: readOnly,
  };
}
```

- [ ] **Step 5: Run tests**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=toolAnnotations
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/utils/toolAnnotations.ts \
        demo_mcp_gateway/src/utils/__tests__/toolAnnotations.test.ts
git commit -m "feat(gateway): add tool annotation helper for readOnly/destructive flags"
```

---

## Task 2: Wire annotations into P1AZ `buildAuthorizeParameters`

**Files:**
- Modify: `demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts`
- Modify (tests): locate existing `pingAuthorizeGuard.test.ts` or `guardToolCall.test.ts`

**Context:** `buildAuthorizeParameters` in `pingAuthorizeGuard.ts` constructs the JSON sent to P1AZ for every `McpToolCall`. The `ToolName` field is already present — annotations go right after it.

**Interfaces:**
- Consumes: `getToolAnnotations(toolName)` from Task 1
- Produces: P1AZ context always includes `ToolReadOnly`, `ToolDestructive`, `ToolIdempotent`, `ElicitationConfirmed`

- [ ] **Step 1: Write the failing test**

In the existing `guardToolCall` test file (find with `grep -r "buildAuthorizeParameters\|guardToolCall" demo_mcp_gateway/src --include="*.test.ts" -l`), add:

```typescript
it('includes tool annotation fields in P1AZ context', async () => {
  // Arrange: spy on the P1AZ client call
  const capturedParams: Record<string, string>[] = [];
  jest.spyOn(pingAuthorizeClient, 'evaluate').mockImplementation(async (params) => {
    capturedParams.push(params);
    return { decision: 'PERMIT', statements: [] };
  });

  // Act: call a known write tool
  await guardToolCall('create_withdrawal', {}, mockToken, mockContext);

  // Assert annotation fields present
  expect(capturedParams[0].ToolDestructive).toBe('true');
  expect(capturedParams[0].ToolReadOnly).toBe('false');
  expect(capturedParams[0].ToolIdempotent).toBe('false');
});

it('sets ElicitationConfirmed from args', async () => {
  const capturedParams: Record<string, string>[] = [];
  jest.spyOn(pingAuthorizeClient, 'evaluate').mockImplementation(async (params) => {
    capturedParams.push(params);
    return { decision: 'PERMIT', statements: [] };
  });

  const argsWithConfirm = { _elicitation_confirmed: true, _elicitation_id: 'test-uuid' };
  await guardToolCall('create_withdrawal', argsWithConfirm, mockToken, mockContext);

  expect(capturedParams[0].ElicitationConfirmed).toBe('true');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=pingAuthorizeGuard
```
Expected: FAIL — fields missing from captured params.

- [ ] **Step 3: Implement**

In `pingAuthorizeGuard.ts`, import the helper and add fields inside `buildAuthorizeParameters`:

```typescript
import { getToolAnnotations } from '../utils/toolAnnotations';

// Inside buildAuthorizeParameters, after the existing ToolName line:
const ann = getToolAnnotations(toolName);
parameters.ToolReadOnly    = ann.readOnly    ? 'true' : 'false';
parameters.ToolDestructive = ann.destructive ? 'true' : 'false';
parameters.ToolIdempotent  = ann.idempotent  ? 'true' : 'false';
parameters.ElicitationConfirmed =
  args?._elicitation_confirmed === true ? 'true' : 'false';
```

- [ ] **Step 4: Run tests**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=pingAuthorizeGuard
```
Expected: PASS including new tests; no existing tests broken.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts
git commit -m "feat(gateway): add ToolReadOnly/ToolDestructive/ElicitationConfirmed to P1AZ context"
```

---

## Task 3: Add `elicitation` obligation type (gateway + BFF + authz mock)

**Files:**
- Modify: `demo_mcp_gateway/src/auth/authorizeObligations.ts`
- Modify: `demo_api_server/services/authorizeObligations.js`
- Modify: `demo_authz_server/` policy file (locate below)

**Context:** `ObligationKind` is `'stepUp' | 'consent' | 'hitl'`. The keyword matcher normalises text (uppercase, separators stripped) and matches substrings. Adding `'elicitation'` is additive — existing callers get `null | 'stepUp' | 'consent' | 'hitl'` today and will get those + `'elicitation'` after this task.

For `demo_authz_server/`: find the file that produces decision statements:
```bash
grep -r "HITL\|step-up-required\|statements" demo_authz_server/ --include="*.js" -l
```
Read that file to understand how it decides which obligation to emit, then add the elicitation rule.

**Interfaces:**
- Produces: `ObligationKind = 'stepUp' | 'consent' | 'hitl' | 'elicitation'` — used by Task 4

- [ ] **Step 1: Write the failing test (gateway)**

In `demo_mcp_gateway/src/auth/__tests__/authorizeObligations.test.ts`:

```typescript
it('classifies ELICITATION statement as elicitation', () => {
  const result = classifyStatement({ code: 'ELICITATION' });
  expect(result).toBe('elicitation');
});

it('classifies ELICITATION case-insensitively', () => {
  expect(classifyStatement({ code: 'elicitation' })).toBe('elicitation');
  expect(classifyStatement({ name: 'Elicitation-Required' })).toBe('elicitation');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=authorizeObligations
```
Expected: FAIL — `'elicitation'` not in the type/returned.

- [ ] **Step 3: Implement gateway obligation type**

```typescript
// authorizeObligations.ts
export type ObligationKind = 'stepUp' | 'consent' | 'hitl' | 'elicitation';

// In the classifyStatement function, add before the hitl check:
if (normalized.includes('ELICITATION')) return 'elicitation';
```

- [ ] **Step 4: Run tests**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=authorizeObligations
```
Expected: PASS.

- [ ] **Step 5: Mirror change in BFF obligations service**

```javascript
// demo_api_server/services/authorizeObligations.js
// Find the same keyword matching logic and add the elicitation case
// at the same position (before hitl check, after consent check):
if (normalized.includes('ELICITATION')) return 'elicitation';
```

Run BFF tests to confirm no regression:
```bash
cd demo_api_server && CI=true npm test -- --forceExit --testPathPattern=authorizeObligations
```

- [ ] **Step 6: Add ELICITATION rule to demo_authz_server**

Find the decision file from Step 1's grep. Read the existing HITL rule pattern. Add:

```javascript
// If the tool is destructive and elicitation not yet confirmed,
// emit the ELICITATION obligation code.
// Add this alongside the existing HITL/step-up emission logic.
// The exact condition depends on what context fields the mock receives —
// use ToolDestructive === 'true' AND ElicitationConfirmed !== 'true'.
if (params.ToolDestructive === 'true' && params.ElicitationConfirmed !== 'true') {
  statements.push({ code: 'ELICITATION', name: 'Elicitation Required' });
  advice.push({ id: 'elicitation-prompt',
    value: `Confirm ${params.ToolName}?` });
}
```

Run authz server tests if they exist:
```bash
cd demo_authz_server && npm test 2>/dev/null || echo "no tests"
```

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_gateway/src/auth/authorizeObligations.ts \
        demo_api_server/services/authorizeObligations.js \
        demo_authz_server/
git commit -m "feat: add elicitation obligation type to gateway and authz mock"
```

---

## Task 4: Gateway elicitation store + -32003 handler

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts`
- Modify (tests): `demo_mcp_gateway/src/__tests__/index.test.ts` or equivalent integration test

**Context:** The existing HITL handler (around line 737–794 of `index.ts`) returns error `-32002` with `challengeId`. The elicitation handler follows the same shape but uses `-32003`, stores a session-scoped record, and validates re-calls using `args._elicitation_id`. The `MCP-Session-Id` header is the session binding key.

**Interfaces:**
- Consumes: `ObligationKind = 'elicitation'` from Task 3
- Produces: `-32003` error with `elicitation_id` on first destructive call; permit on validated re-call

- [ ] **Step 1: Write failing tests**

```typescript
// In the gateway integration test file — add alongside existing HITL tests:

describe('elicitation flow', () => {
  it('returns -32003 on first destructive call when ELICITATION obligation fires', async () => {
    // Mock P1AZ to return ELICITATION obligation for create_withdrawal
    mockPingAuthorize.evaluate.mockResolvedValue({
      decision: 'DENY',
      statements: [{ code: 'ELICITATION', name: 'Elicitation Required' }],
      advice: [{ id: 'elicitation-prompt', value: 'Confirm create_withdrawal?' }],
    });

    const res = await callToolViaGateway('create_withdrawal', { amount: 500 }, {
      'mcp-session-id': 'test-session-1',
    });

    expect(res.error.code).toBe(-32003);
    expect(res.error.message).toBe('elicitation_required');
    expect(res.error.data.elicitation_id).toBeTruthy();
    expect(res.error.data.prompt).toBe('Confirm create_withdrawal?');
    expect(res.error.data.expires_in).toBe(120);
  });

  it('permits on re-call with valid elicitation_id', async () => {
    // First call to get elicitation_id
    mockPingAuthorize.evaluate
      .mockResolvedValueOnce({
        decision: 'DENY',
        statements: [{ code: 'ELICITATION' }],
        advice: [{ id: 'elicitation-prompt', value: 'Confirm?' }],
      })
      .mockResolvedValueOnce({ decision: 'PERMIT', statements: [] });

    const first = await callToolViaGateway('create_withdrawal', { amount: 500 }, {
      'mcp-session-id': 'test-session-2',
    });
    const { elicitation_id } = first.error.data;

    const second = await callToolViaGateway(
      'create_withdrawal',
      { amount: 500, _elicitation_confirmed: true, _elicitation_id: elicitation_id },
      { 'mcp-session-id': 'test-session-2' },
    );

    expect(second.error).toBeUndefined();
    // ElicitationConfirmed should have been sent to P1AZ on second call
    const secondCallParams = mockPingAuthorize.evaluate.mock.calls[1][0];
    expect(secondCallParams.ElicitationConfirmed).toBe('true');
  });

  it('rejects re-call with wrong session', async () => {
    mockPingAuthorize.evaluate.mockResolvedValue({
      decision: 'DENY',
      statements: [{ code: 'ELICITATION' }],
      advice: [{ id: 'elicitation-prompt', value: 'Confirm?' }],
    });
    const first = await callToolViaGateway('create_withdrawal', {}, {
      'mcp-session-id': 'session-A',
    });
    const { elicitation_id } = first.error.data;

    const second = await callToolViaGateway(
      'create_withdrawal',
      { _elicitation_confirmed: true, _elicitation_id: elicitation_id },
      { 'mcp-session-id': 'session-B' },  // different session
    );

    expect(second.error.code).toBe(-32003);
    expect(second.error.data.reason).toBe('invalid_or_expired');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=index
```
Expected: FAIL on elicitation tests.

- [ ] **Step 3: Implement elicitation store and handler**

At the top of `index.ts`, after existing imports:

```typescript
import { randomUUID } from 'crypto';

interface PendingElicitation {
  elicitation_id: string;
  toolName: string;
  sessionId: string;
  prompt: string;
  expiresAt: number;
}
const pendingElicitations = new Map<string, PendingElicitation>();

// Sweep expired records every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of pendingElicitations) {
    if (rec.expiresAt < now) pendingElicitations.delete(id);
  }
}, 60_000).unref();
```

In the obligation-handling block of `tools/call` (find by searching for `HITL_REQUIRED` or `-32002`), add the elicitation branch **before** the existing HITL check:

```typescript
if (obligationKind === 'elicitation') {
  const sessionId = req.headers['mcp-session-id'] as string ?? '';
  const prompt = authorizeResult.advice?.find(
    (a: { id: string }) => a.id === 'elicitation-prompt'
  )?.value ?? `Confirm ${toolName}?`;
  const id = randomUUID();
  pendingElicitations.set(id, {
    elicitation_id: id,
    toolName,
    sessionId,
    prompt,
    expiresAt: Date.now() + 120_000,
  });
  return res.json({
    jsonrpc: '2.0',
    id: reqId,
    error: {
      code: -32003,
      message: 'elicitation_required',
      data: { elicitation_id: id, prompt, tool_name: toolName, expires_in: 120 },
    },
  });
}
```

In the pre-P1AZ check for re-calls — add before calling `buildAuthorizeParameters`:

```typescript
if (args?._elicitation_confirmed === true) {
  const rec = pendingElicitations.get(args._elicitation_id as string);
  const sessionId = req.headers['mcp-session-id'] as string ?? '';
  if (!rec || rec.toolName !== toolName || rec.sessionId !== sessionId || rec.expiresAt < Date.now()) {
    return res.json({
      jsonrpc: '2.0', id: reqId,
      error: { code: -32003, message: 'elicitation_required',
               data: { reason: 'invalid_or_expired' } },
    });
  }
  pendingElicitations.delete(rec.elicitation_id);
  // ElicitationConfirmed: 'true' is added by buildAuthorizeParameters (Task 2)
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_mcp_gateway && npm test
```
Expected: PASS. Existing HITL tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "feat(gateway): elicitation store and -32003 handler with session-bound re-call validation"
```

---

## Task 5: BFF intercepts elicitation events + confirm/deny routes

**Files:**
- Modify: `demo_api_server/routes/agentRun.js`
- Modify (tests): `demo_api_server/tests/routes/agentRun.test.js` (or equivalent)

**Context — read this first:**
`agentRun.js` is a **proxy**, not a loop. It pipes SSE events from the downstream agent service (LangChain/Mastra). The agent service calls the MCP gateway; when the gateway returns `-32003`, the agent service must convert this to an `ELICITATION_REQUIRED` AG-UI event and emit it over its own SSE stream. The BFF then:
1. Intercepts that event in its pipe-through handler
2. Stores pending elicitation state on the express session
3. Exposes `POST /api/agent/elicitation/:id/confirm` and `.../deny`

**Read the existing HITL interrupt code in agentRun.js** (search for `hitl` or `HITL_CONSENT` in that file) to understand the exact pub-sub pattern used for HITL confirmation. Model elicitation exactly the same way — the only difference is the event type name.

**ALSO read the agent service that makes tool calls** — either `langchain_agent/` or `mastra_agent/` — for how it handles gateway errors. You will need to add `-32003` handling there in Task 5b (see below).

- [ ] **Step 1: Write failing test for confirm/deny routes**

```javascript
// demo_api_server/tests/routes/agentRun.test.js
describe('elicitation confirm/deny', () => {
  it('confirm route calls resolve with true', async () => {
    // Arrange: put a pending elicitation on the session
    req.session.pendingElicitation = {
      elicitation_id: 'test-uuid-1',
      tool_name: 'create_withdrawal',
      resolve: jest.fn(),
    };

    const res = await request(app)
      .post('/api/agent/elicitation/test-uuid-1/confirm')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(req.session.pendingElicitation.resolve).toHaveBeenCalledWith(true);
  });

  it('deny route calls resolve with false', async () => {
    req.session.pendingElicitation = {
      elicitation_id: 'test-uuid-2',
      tool_name: 'create_withdrawal',
      resolve: jest.fn(),
    };

    const res = await request(app)
      .post('/api/agent/elicitation/test-uuid-2/deny')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(req.session.pendingElicitation.resolve).toHaveBeenCalledWith(false);
  });

  it('returns 404 if no pending elicitation matches id', async () => {
    req.session.pendingElicitation = null;
    const res = await request(app)
      .post('/api/agent/elicitation/unknown-id/confirm')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --testPathPattern=agentRun
```
Expected: FAIL — routes not found.

- [ ] **Step 3: Add elicitation intercept and routes to `agentRun.js`**

In the SSE pipe-through handler (where the BFF reads chunks from the agent service), add detection for `ELICITATION_REQUIRED` event type:

```javascript
// In the chunk handler that parses agent service SSE events:
if (event.type === 'ELICITATION_REQUIRED') {
  // Store a resolve function on the session; the confirm/deny routes call it
  let resolveElicitation;
  const elicitationPromise = new Promise(resolve => { resolveElicitation = resolve; });
  req.session.pendingElicitation = {
    elicitation_id: event.elicitation_id,
    tool_name: event.tool_name,
    resolve: resolveElicitation,
  };
  req.session.save();
  // Forward the event to the browser unchanged so the UI can render the modal
  res.write('data: ' + JSON.stringify(event) + '\n\n');
  // Pause: wait for confirm/deny before allowing the agent service stream to continue
  // (exact mechanism depends on how HITL does this — mirror it)
}
```

Add confirm/deny routes (mount them next to the existing agent routes):

```javascript
router.post('/elicitation/:id/confirm', authenticateToken, (req, res) => {
  const pending = req.session?.pendingElicitation;
  if (!pending || pending.elicitation_id !== req.params.id) {
    return res.status(404).json({ error: 'no_pending_elicitation' });
  }
  pending.resolve(true);
  req.session.pendingElicitation = null;
  req.session.save();
  res.json({ ok: true });
});

router.post('/elicitation/:id/deny', authenticateToken, (req, res) => {
  const pending = req.session?.pendingElicitation;
  if (!pending || pending.elicitation_id !== req.params.id) {
    return res.status(404).json({ error: 'no_pending_elicitation' });
  }
  pending.resolve(false);
  req.session.pendingElicitation = null;
  req.session.save();
  res.json({ ok: true });
});
```

- [ ] **Step 4: Add `-32003` handling in the agent service**

Read the agent service that makes MCP tool calls (find with:
```bash
grep -r "\-32002\|HITL_REQUIRED\|hitl_challenge" langchain_agent/ mastra_agent/ \
  --include="*.py" --include="*.ts" --include="*.js" -l 2>/dev/null
```
).

In the tool-call error handler of that agent service, add alongside the existing `-32002` case:

```typescript
// or equivalent Python if langchain_agent is the target
if (error.code === -32003) {
  // Emit ELICITATION_REQUIRED AG-UI event to the SSE stream
  emitEvent({
    type: 'ELICITATION_REQUIRED',
    elicitation_id: error.data.elicitation_id,
    prompt: error.data.prompt,
    tool_name: error.data.tool_name,
    expires_in: error.data.expires_in,
  });
  // Wait for confirmation — use same mechanism as HITL (pub-sub, webhook, etc.)
  const confirmed = await waitForElicitationConfirmation(error.data.elicitation_id);
  if (confirmed) {
    // Retry the tool call with confirmation args
    return retryToolCall(toolName, {
      ...originalArgs,
      _elicitation_confirmed: true,
      _elicitation_id: error.data.elicitation_id,
    });
  } else {
    throw new Error(`User declined: ${toolName}`);
  }
}
```

The `waitForElicitationConfirmation` mechanism: **read the existing HITL wait implementation** and mirror it exactly.

- [ ] **Step 5: Run BFF tests**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --testPathPattern=agentRun
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/agentRun.js
# Add the agent service file you modified:
git add <agent-service-file>
git commit -m "feat(bff): intercept elicitation events and add confirm/deny routes"
```

---

## Task 6: UI `ElicitationModal` and agent view wiring

**Files:**
- Create: `demo_api_ui/src/components/ElicitationModal.jsx`
- Modify: agent view component (locate with: `grep -r "ELICITATION_REQUIRED\|elicitation\|agentRun\|SSE" demo_api_ui/src --include="*.jsx" --include="*.tsx" -l`)

**Constraints:** Must use `DraggableModal`. No `window.confirm()`. No emojis outside allowlist. Buttons: `Confirm` and `Cancel`.

- [ ] **Step 1: Write failing vitest**

```javascript
// demo_api_ui/src/components/__tests__/ElicitationModal.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import ElicitationModal from '../ElicitationModal';

it('renders prompt and confirm/cancel buttons when open', () => {
  render(
    <ElicitationModal
      isOpen={true}
      prompt="Confirm withdrawal of $500?"
      toolName="create_withdrawal"
      elicitationId="test-uuid"
      onConfirm={jest.fn()}
      onDeny={jest.fn()}
    />
  );
  expect(screen.getByText('Confirm withdrawal of $500?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('calls onConfirm when Confirm is clicked', () => {
  const onConfirm = jest.fn();
  render(
    <ElicitationModal
      isOpen={true}
      prompt="Confirm?"
      toolName="create_withdrawal"
      elicitationId="uuid-1"
      onConfirm={onConfirm}
      onDeny={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('calls onDeny when Cancel is clicked', () => {
  const onDeny = jest.fn();
  render(
    <ElicitationModal
      isOpen={true}
      prompt="Confirm?"
      toolName="create_withdrawal"
      elicitationId="uuid-2"
      onConfirm={jest.fn()}
      onDeny={onDeny}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onDeny).toHaveBeenCalledTimes(1);
});

it('does not render when isOpen is false', () => {
  render(
    <ElicitationModal
      isOpen={false}
      prompt="Confirm?"
      toolName="t"
      elicitationId="u"
      onConfirm={jest.fn()}
      onDeny={jest.fn()}
    />
  );
  expect(screen.queryByText('Confirm?')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_api_ui && npm run test:unit -- ElicitationModal
```
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `ElicitationModal.jsx`**

```jsx
import React from 'react';
import DraggableModal from './DraggableModal';
import apiClient from '../services/apiClient';

export default function ElicitationModal({
  isOpen,
  prompt,
  toolName,
  elicitationId,
  onConfirm,
  onDeny,
}) {
  const handleConfirm = async () => {
    await apiClient.post(`/api/agent/elicitation/${elicitationId}/confirm`);
    onConfirm();
  };

  const handleDeny = async () => {
    await apiClient.post(`/api/agent/elicitation/${elicitationId}/deny`);
    onDeny();
  };

  return (
    <DraggableModal
      title="Confirm Action"
      isOpen={isOpen}
      onClose={handleDeny}
    >
      <p className="elicitation-prompt">{prompt}</p>
      <div className="elicitation-actions">
        <button className="elicitation-btn elicitation-btn--confirm" onClick={handleConfirm}>
          Confirm
        </button>
        <button className="elicitation-btn elicitation-btn--cancel" onClick={handleDeny}>
          Cancel
        </button>
      </div>
    </DraggableModal>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_api_ui && npm run test:unit -- ElicitationModal
```
Expected: PASS (4 tests).

- [ ] **Step 5: Wire SSE event to modal in agent view**

Find the agent view component (grep above). In the SSE event handler, add alongside existing event type handling:

```jsx
// In useEffect or wherever SSE events are processed:
case 'ELICITATION_REQUIRED':
  setPendingElicitation({
    isOpen: true,
    prompt: event.prompt,
    toolName: event.tool_name,
    elicitationId: event.elicitation_id,
  });
  break;
```

Add state and render:

```jsx
const [pendingElicitation, setPendingElicitation] = useState(null);

// In the JSX, alongside other modals:
<ElicitationModal
  isOpen={!!pendingElicitation?.isOpen}
  prompt={pendingElicitation?.prompt ?? ''}
  toolName={pendingElicitation?.toolName ?? ''}
  elicitationId={pendingElicitation?.elicitationId ?? ''}
  onConfirm={() => setPendingElicitation(null)}
  onDeny={() => setPendingElicitation(null)}
/>
```

- [ ] **Step 6: Run full UI checks**

```bash
cd demo_api_ui && npm run test:unit && npm run build
```
Expected: tests PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/ElicitationModal.jsx \
        demo_api_ui/src/components/__tests__/ElicitationModal.test.jsx \
        <agent-view-file>
git commit -m "feat(ui): add ElicitationModal for inline destructive tool confirmation"
```

---

## Task 7: Integration smoke test + final gate

- [ ] **Step 1: Run all touched test suites**

```bash
cd demo_mcp_gateway && npm test
cd demo_api_server && CI=true npm test -- --forceExit
cd demo_api_ui && npm run test:unit && npm run build
npm run topology:verify
npm run hygiene:check
```

All must be green before proceeding.

- [ ] **Step 2: Manual end-to-end check (against running stack)**

```bash
./run-docker.sh restart demo-api-server mcp-gateway
```

1. Navigate to `https://local.ping-devops.com:4000` as the demo user
2. Trigger a write tool (e.g. create a withdrawal via the agent chat)
3. Verify: elicitation modal appears with the correct prompt
4. Click **Confirm** — verify tool call completes
5. Repeat — click **Cancel** — verify agent responds gracefully with "User declined"
6. Trigger a read tool (get_my_accounts) — verify: no modal, no -32003
7. Verify HITL path still works: trigger a scenario that previously required HITL — must still return -32002 and complete via the existing HITL flow

- [ ] **Step 3: Final commit and PR**

```bash
git add -p   # review everything staged
git commit -m "chore: integration verified — elicitation e2e pass"
```

Then run:
```bash
/commit-push-pr
```
or follow the commit-commands skill.

---

## Plan: Step #3 — MCP Resources

This is a separate plan (independent subsystem). To be written after Option A is shipped.

**Scope:** Expose banking account and transaction data as MCP `resources/list` + `resources/read` + subscriptions in `demo_mcp_server`. The gateway gains `resources/list` and `resources/read` forwarding with P1AZ enforcement (same annotation + obligation pattern established by Option A). BFF and UI gain a resource browser panel.

**Estimate:** ~5 tasks. Write the plan with: `docs/superpowers/plans/2026-08-14-mcp-resources.md`
