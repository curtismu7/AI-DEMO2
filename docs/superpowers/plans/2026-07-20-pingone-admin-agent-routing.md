# PingOne Admin Agent Routing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `sendAgentMessage()` call for `vertical === 'pingone-admin'` reach the real admin backend (`POST /api/admin-agent/message`) instead of misrouting to the customer/banking agent.

**Architecture:** One new branch at the top of `sendAgentMessage()` in `demo_api_ui/src/services/demoAgentService.js` delegates to a new sibling function `sendToAdminAgent()` that posts to `/api/admin-agent/message` and normalizes the response into `sendAgentMessage`'s existing return contract. No other file changes except the required regression-guard log entry.

**Tech Stack:** React + Vite (demo_api_ui), Vitest (frontend tests).

## Global Constraints

- Single file touched for the fix: `demo_api_ui/src/services/demoAgentService.js`. No changes to `AIAgent.js`, `agentInvokeRoute.js`, `demoAgentLangGraphService.js`, or `customerTokenGuard.js`.
- `AIAgent.js:8043`'s `PINGONE_ADMIN_CHIP_IDS`-gated inline block stays exactly as-is — do not remove, refactor, or route it through the new `sendToAdminAgent`.
- The new admin branch must return before the banking path's SSE setup (`openMcpFlowSse`) runs — the admin agent doesn't publish to that hub.
- Return shape from `sendToAdminAgent` must match `sendAgentMessage`'s existing contract shape (`{ ...data, _status: res.status }`) — same field names (`reply`, `success`, `requiresConsent`, `agentConfigured`, `inputTokens`, `outputTokens`, `tokenEvents`, `_status`).
- `onTokenEvent` fires once per item in the response's `tokenEvents` array (batched), not streamed.
- Worktree: `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-pingone-admin-agent-routing`, branch `worktree-fix-pingone-admin-agent-routing`. All commands below assume this cwd.
- After any `demo_api_ui/` change: `cd demo_api_ui && npm run build` must exit 0 before the work is done (regression-guard requirement).
- This is a real bug fix touching a protected area (agent message routing) — `REGRESSION_PLAN.md` §4 needs a new reverse-chronological entry (Files changed / What was broken / What was fixed / Do not break / Verify), inserted immediately after line 102 (`Reverse-chronological, newest first.`), before the existing 2026-07-19 entry.
- This worktree needs `demo_api_ui/node_modules` — symlink to the main checkout's if missing (lockfiles are gitignored repo-wide, worktrees don't inherit installed deps).

---

### Task 1: `sendToAdminAgent()` + `sendAgentMessage()` routing branch

**Files:**
- Modify: `demo_api_ui/src/services/demoAgentService.js:1020` (top of `sendAgentMessage`, add branch + new sibling function)
- Test: `demo_api_ui/src/services/__tests__/demoAgentService.adminRouting.test.js` (new)

**Interfaces:**
- Produces: `sendToAdminAgent(message, { signal, onTokenEvent } = {})` — internal (not exported), returns
  `Promise<{ reply: string, success: boolean, requiresConsent: false, agentConfigured: boolean|undefined, inputTokens: number|undefined, outputTokens: number|undefined, tokenEvents: Array, _status: number }>`.
- Consumes (already imported/available in `demoAgentService.js`): `adminCustomerContext` from `../services/adminCustomerContext` (already imported at the top of the file for the existing `body.customer` line ~1032 — confirm the import exists; if not, add `import { adminCustomerContext } from './adminCustomerContext';` matching the existing relative-path convention in this file).
- `sendAgentMessage`'s existing signature is unchanged: `sendAgentMessage(message, consentId = null, { signal, forceHeuristic, vertical, consentGiven, hitlChallengeId, useCaseId, onTokenEvent } = {})`. Only its body gains a branch at the very top.

- [ ] **Step 1: Symlink node_modules if missing**

```bash
test -d demo_api_ui/node_modules || ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules
```

- [ ] **Step 2: Write the failing tests**

Create `demo_api_ui/src/services/__tests__/demoAgentService.adminRouting.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openMcpFlowSse = vi.fn(() => () => {});
vi.mock('../mcpFlowSseClient', () => ({ openMcpFlowSse }));
vi.mock('../apiTrafficStore', () => ({
  appendTokenEvents: vi.fn(),
  setCurrentTurn: vi.fn(),
  clearCurrentTurn: vi.fn(),
}));
vi.mock('../apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../agentFlowDiagramService', () => ({
  agentFlowDiagram: {
    startMcpToolCall: vi.fn(),
    applyServerEvent: vi.fn(),
    completeMcpToolCall: vi.fn(),
  },
}));
vi.mock('../tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    beginTrace: vi.fn(),
    ingestRoutingMode: vi.fn(),
    ingestTokenEvents: vi.fn(),
    ingestMcpResult: vi.fn(),
    ingestAuthorize: vi.fn(),
    ingestLlmDetail: vi.fn(),
    ingestLlmReply: vi.fn(),
    completeTrace: vi.fn(),
  },
}));
vi.mock('../milestonesStore', () => ({
  addMilestone: vi.fn(() => 'milestone-id'),
  updateMilestoneStatus: vi.fn(),
}));
vi.mock('../adminCustomerContext', () => ({
  adminCustomerContext: { get: vi.fn(() => null) },
}));

import { sendAgentMessage } from '../demoAgentService';

describe('sendAgentMessage — pingone-admin vertical routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to /api/admin-agent/message instead of /api/agent/invoke', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'admin reply', success: true, tokenEvents: [] }),
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin-agent/message');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ message: 'list applications', customer: null });
    expect(result).toMatchObject({ reply: 'admin reply', success: true, requiresConsent: false, _status: 200 });
  });

  it('does not open the SSE flow-trace connection for the admin path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'admin reply', success: true, tokenEvents: [] }),
    });
    await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(openMcpFlowSse).not.toHaveBeenCalled();
  });

  it('fires onTokenEvent once per item in the batched tokenEvents array', async () => {
    const onTokenEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'admin reply',
        success: true,
        tokenEvents: [{ id: 'a' }, { id: 'b' }],
      }),
    });
    await sendAgentMessage('list applications', null, { vertical: 'pingone-admin', onTokenEvent });
    expect(onTokenEvent).toHaveBeenCalledTimes(2);
    expect(onTokenEvent).toHaveBeenNthCalledWith(1, { id: 'a' });
    expect(onTokenEvent).toHaveBeenNthCalledWith(2, { id: 'b' });
  });

  it('falls back to a generic failure reply on unparseable JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(result).toMatchObject({ reply: 'Admin agent request failed.', success: false });
  });

  it('still routes non-admin verticals through /api/agent/invoke unchanged', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ json: async () => ({ success: true, reply: 'banking reply' }) }),
      json: async () => ({ success: true, reply: 'banking reply' }),
    });
    const result = await sendAgentMessage('show my balance', null, { vertical: 'banking' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/agent/invoke');
    expect(result.reply).toBe('banking reply');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/demoAgentService.adminRouting.test.js`
Expected: FAIL — `sendAgentMessage` doesn't branch on `vertical === 'pingone-admin'` yet, so every test hits `/api/agent/invoke` and the admin-specific assertions (URL, body shape, no-SSE, batched token events) fail. The last test (banking vertical unchanged) may already pass — that's fine, it's a regression guard, not new behavior.

- [ ] **Step 4: Implement `sendToAdminAgent` and the routing branch**

In `demo_api_ui/src/services/demoAgentService.js`, first confirm `adminCustomerContext` is already imported (it's referenced at the existing line ~1032 `const _adminCustomer = adminCustomerContext.get();`) — if the import is missing, add it near the file's other relative imports, matching the existing import style in this file.

Add this new function immediately before `export async function sendAgentMessage(...)`:

```js
/**
 * Routes a pingone-admin-vertical message to the dedicated admin agent
 * backend (live PingOne Management API tools via adminAgentService.js) —
 * the customer/banking /api/agent/invoke path can't serve this vertical,
 * it always bounces with requiresCustomerLogin for an admin token.
 */
async function sendToAdminAgent(message, { signal, onTokenEvent } = {}) {
  const res = await fetch("/api/admin-agent/message", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      customer: adminCustomerContext.get(),
    }),
    signal: signal || AbortSignal.timeout(30000),
  });
  const data = await res
    .json()
    .catch(() => ({ reply: "Admin agent request failed.", success: false }));
  if (Array.isArray(data.tokenEvents)) {
    for (const ev of data.tokenEvents) {
      onTokenEvent?.(ev);
    }
  }
  return {
    reply: data.reply,
    success: data.success,
    requiresConsent: false,
    agentConfigured: data.agentConfigured,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    tokenEvents: data.tokenEvents || [],
    _status: res.status,
  };
}
```

Then change the top of `sendAgentMessage` (currently starts with
`export async function sendAgentMessage(message, consentId = null, { signal, forceHeuristic = false, vertical = null, consentGiven = false, hitlChallengeId = null, useCaseId = null, onTokenEvent } = {}) {`)
to branch immediately:

```js
export async function sendAgentMessage(message, consentId = null, { signal, forceHeuristic = false, vertical = null, consentGiven = false, hitlChallengeId = null, useCaseId = null, onTokenEvent } = {}) {
  if (vertical === 'pingone-admin') {
    return sendToAdminAgent(message, { signal, onTokenEvent });
  }
  const body = { prompt: message };
  // ...rest of the existing function body, completely unchanged from here down
```

Everything after the new `if` block — the existing `body`, SSE setup, fetch to
`/api/agent/invoke`, 401 retry, response normalization — stays exactly as it
is today. Only the function's opening lines change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/demoAgentService.adminRouting.test.js`
Expected: PASS, all 5 tests.

- [ ] **Step 6: Run the full demoAgentService test suite**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/demoAgentService.tokenEventCallback.test.js src/services/__tests__/demoAgentService.hitlRetry.test.js src/services/__tests__/demoAgentService.timeoutSync.test.js src/services/__tests__/demoAgentService.legacyTrace.test.js src/services/__tests__/demoAgentService.adminRouting.test.js`
Expected: PASS, all pre-existing tests plus the 5 new ones — confirms the banking path's early lines (`body`, SSE, fetch) are byte-for-byte unchanged for every non-admin call.

- [ ] **Step 7: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/services/__tests__/demoAgentService.adminRouting.test.js
git commit -m "fix(pingone-admin): route sendAgentMessage to the admin agent backend for vertical=pingone-admin"
```

---

### Task 2: Regression log entry

**Files:**
- Modify: `REGRESSION_PLAN.md:102-104` (insert new entry between the "Reverse-chronological" line and the existing 2026-07-19 entry)

**Interfaces:** None — documentation only, no code interface.

- [ ] **Step 1: Insert the §4 entry**

In `REGRESSION_PLAN.md`, immediately after line 102
(`Reverse-chronological, newest first.`) and its blank line, before the
existing `### 2026-07-19 — Demo Config page...` entry, insert:

```markdown
### 2026-07-20 — PingOne Admin AI Agent messages misrouted to the customer/banking agent

**Files changed:**
- `demo_api_ui/src/services/demoAgentService.js` — `sendAgentMessage` branches
  to a new `sendToAdminAgent` helper when `vertical === 'pingone-admin'`,
  posting to `/api/admin-agent/message` instead of `/api/agent/invoke`.

**What was broken:** every `sendAgentMessage()` call site (demo-step clicks,
free-typed chat, heuristic-resolved vertical re-dispatch) sent
`pingone-admin`-vertical messages to `/api/agent/invoke`, which always calls
the customer/banking agent (`processAgentMessage` in
`demoAgentLangGraphService.js`). That service's admin-token guard
(`customerTokenGuard.js`'s `isVerticalExemptFromAdminTokenGuard`, exempting
only `{admin, oauth-teaching}`) correctly refused with `requiresCustomerLogin`
for an admin token — but the request was going to the wrong backend
regardless. The real admin backend (`adminAgentService.js`, live PingOne
Management API tools) was only reachable via a narrow
`PINGONE_ADMIN_CHIP_IDS.has(chipId)` gate in `AIAgent.js` that demo steps and
typed chat never passed through.

**What was fixed:** `sendAgentMessage` now checks `vertical` first and routes
`pingone-admin` messages to `/api/admin-agent/message` directly, normalizing
the response into the same return shape every caller already expects.

**Do not break:** the `PINGONE_ADMIN_CHIP_IDS`-gated inline block in
`AIAgent.js` still exists unchanged and still works for its pre-wired chips —
this fix doesn't consolidate into it. Non-admin verticals (banking,
healthcare, retail, …) must keep hitting `/api/agent/invoke` exactly as
before; `customerTokenGuard.js`'s exempt list and `agentInvokeRoute.js` are
untouched.

**Verify:** `demo_api_ui` vitest `demoAgentService.adminRouting` (5 pass,
including the non-admin-vertical-unchanged regression case) +
`demoAgentService.{tokenEventCallback,hitlRetry,timeoutSync,legacyTrace}`
still green; `cd demo_api_ui && npm run build` exits 0. Live click-through:
each of the 4 PingOne Admin demo steps gets a real tool-backed reply, typed
chat in the admin agent works, banking vertical chat/chips unaffected.
```

- [ ] **Step 2: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs: log the pingone-admin agent routing fix in REGRESSION_PLAN §4"
```

---

### Task 3: Manual live verification

**Files:** none (verification only).

- [ ] **Step 1: Verify the 4 admin demo steps work end-to-end**

Open `https://local.ping-devops.com:4000/admin` (sign-in only works on this
host per project convention), log in as `demoAdmin` / the password in
`demo_api_server/.env`'s `DEMO_ADMIN_PASSWORD`, switch the vertical picker to
"PingOne Admin", open the PingOne Admin AI Agent, click "Demo steps", run
each of the 4 steps in turn. Expected: each produces a real tool-backed reply
(actual application/user/population data or a real PingOne API result) —
NOT the "This action needs a customer sign-in..." card.

- [ ] **Step 2: Verify free-typed chat works**

In the same agent panel, type a message directly (e.g. "list all
applications") and send it. Expected: same real tool-backed reply behavior
as a demo step — confirms the fix isn't just chip/demo-step-specific.

- [ ] **Step 3: Verify the banking vertical is unaffected**

Switch the vertical picker back to "Super Banking", open its agent, send a
typed message (e.g. "show my balance") and click a chip. Expected: both
still work exactly as before — confirms `sendAgentMessage`'s banking path is
untouched.

No commit for this task — verification only.
