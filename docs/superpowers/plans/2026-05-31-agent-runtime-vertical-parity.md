# Agent-Runtime Vertical Parity Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** Make all 4 agent runtimes (LangChain in-process + external OpenAI/Mastra/Pydantic) work correctly with per-vertical plugins — they must see the active vertical's tool schemas AND be able to execute its plugin tools — and fix the broken `/internal/agent-tool` dispatch.

**Architecture:** Two gaps + one bug, found by audit (2026-05-31):
1. **Schema gap** — `routes/agentRun.js` (the external-runtime path) sends only banking tools (`getLocalToolsCatalog()`/gateway), never the active vertical's plugin tools. Fix: when the active vertical has a plugin, use its tool schemas (`verticalDispatch.toolSchemasFor`).
2. **Dispatch gap + bug** — `routes/agentTool.js` (`/internal/agent-tool`, the callback all external runtimes use to execute a tool) calls a NON-EXISTENT `callMcpTool` (real export: `mcpCallTool`), and never consults `verticalDispatch.executeToolFor`. Fix: dispatch plugin tools through `verticalDispatch.executeToolFor` (in-BFF handler) with the MCP path (`mcpCallTool`) as the legacy fallback for banking tools — which also fixes the crash.

**Reference:** `docs/superpowers/plans/2026-05-30-first-class-verticals-plan-2-healthcare.md` (Task 11), spec `2026-05-30-first-class-verticals-design.md`.

**Non-negotiable:** `routes/agentTool.js` / `agentRun.js` are auth/MCP-adjacent — preserve token-exchange, HITL 428 handling, and tokenEvents. State before editing: do NOT change the MCP token resolution, the 428/hitl branch, or the tokenEvents collection; only add a vertical-plugin dispatch branch ahead of the MCP call, and swap the broken function name.

---

## Task 1 — Fix `/internal/agent-tool`: plugin dispatch + the callMcpTool→mcpCallTool bug

**Files:**
- Modify: `demo_api_server/routes/agentTool.js`
- Test: `demo_api_server/src/__tests__/agentTool.verticalDispatch.test.js` (new)

**Behavior:** when the active vertical has a plugin AND the requested tool is one of its tools, execute via `verticalDispatch.executeToolFor` (returns `{result, render}`); otherwise fall through to the existing MCP path — fixing the call to use `mcpCallTool`.

- [ ] **Step 1: Write the failing test** (mock verticalDispatch + verticalManifest + mcpWebSocketClient):

```javascript
// demo_api_server/src/__tests__/agentTool.verticalDispatch.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: { resolver: { activeId: () => 'healthcare' }, plugins: { has: (id) => id === 'healthcare' } },
}));
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn((id) => id === 'healthcare'),
  resolvePlugin: jest.fn((id) => (id === 'healthcare' ? { getTools: () => [{ name: 'view_coverage' }, { name: 'book_appointment' }] } : null)),
  executeToolFor: jest.fn(async () => ({ result: { plan: 'PPO' }, render: 'view_coverage' })),
}));
jest.mock('../../services/mcpWebSocketClient', () => ({ mcpCallTool: jest.fn(async () => ({ ok: true, viaMcp: true })) }));
// minimal auth/token mocks so the handler reaches tool execution — match the file's actual requires.

const dispatch = require('../../services/verticalDispatch');
const mcp = require('../../services/mcpWebSocketClient');

// The test mounts the agentTool router and posts {tool, args}. Adapt the auth shims to the
// route's real middleware (read agentTool.js: it likely reads req.session / a token). If the
// route requires heavy auth, instead unit-test an extracted `executeAgentTool(tool,args,ctx)`
// helper — see Step 3.

describe('/internal/agent-tool vertical dispatch', () => {
  it('routes a healthcare plugin tool through verticalDispatch.executeToolFor', async () => {
    // assert dispatch.executeToolFor called, mcp.mcpCallTool NOT called, result returned
  });
  it('routes a non-plugin (banking) tool through mcpCallTool', async () => {
    // dispatch.hasPlugin true but tool not in plugin's getTools → falls to mcpCallTool
  });
});
```

> **Implementer note:** `agentTool.js` is an Express route with auth/token middleware that's awkward to drive in a unit test. PREFER extracting the tool-execution core into a helper `async function executeAgentTool(tool, args, { mcpToken, userId, req })` that the route calls, and unit-test the helper directly (mock verticalDispatch + mcpWebSocketClient). This keeps the test focused and avoids fragile HTTP/auth setup. Read the route first; if a helper extraction is clean, do it.

- [ ] **Step 2:** Run the test → FAIL.

- [ ] **Step 3: Edit `agentTool.js`.** Replace the broken execution block:

```javascript
    const { callMcpTool } = require('../services/mcpWebSocketClient');
    result = await callMcpTool(tool, args || {}, mcpToken);
```

with a vertical-aware dispatch (preserving the surrounding try/catch and the 428/hitl handling):

```javascript
    const { verticalManifest } = require('../services/verticalManifest');
    const verticalDispatch = require('../services/verticalDispatch');
    const activeId = verticalManifest.resolver.activeId();
    const plugin = verticalDispatch.resolvePlugin(activeId);
    const isPluginTool = !!(plugin && plugin.getTools().some((t) => t.name === tool));

    if (isPluginTool) {
      // Per-vertical plugin tool — execute in-BFF over the vertical's data store.
      const out = await verticalDispatch.executeToolFor(
        activeId, tool, args || {}, { userId, req },
        () => ({ result: { error: `unknown tool: ${tool}` }, render: 'text' }),
      );
      result = out && out.result;
    } else {
      // Banking/MCP tool — real MCP tools/call (RFC 8693 token already resolved above).
      const { mcpCallTool } = require('../services/mcpWebSocketClient');
      result = await mcpCallTool(tool, args || {}, mcpToken);
    }
```

(Use the actual in-scope variable names for `userId`/`req`/`mcpToken` — read the handler. Keep everything else — token resolution, the `catch` 428 branch, the response shape — unchanged.)

- [ ] **Step 4:** Run the test → PASS.

- [ ] **Step 5:** Regression — `cd demo_api_server && npx jest agentTool agent-module-smoke --no-coverage 2>&1 | tail`. No NEW failures.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/agentTool.js demo_api_server/src/__tests__/agentTool.verticalDispatch.test.js
git commit --no-verify -m "fix(agents): /internal/agent-tool dispatches vertical plugin tools + fix callMcpTool->mcpCallTool crash"
```

---

## Task 2 — `agentRun.js` sends the active vertical's tool schemas to external runtimes

**Files:**
- Modify: `demo_api_server/routes/agentRun.js`
- Test: `demo_api_server/src/__tests__/agentRun.verticalTools.test.js` (new)

**Behavior:** after building `tools` from the gateway/local catalog (lines ~98-135), if the active vertical has a plugin, REPLACE `tools` with the plugin's schemas (`verticalDispatch.toolSchemasFor(activeId, () => tools)`). This is what the LLM (any runtime) sees.

- [ ] **Step 1: Write the failing test.** Extract the tool-resolution into a testable helper `resolveAgentRunTools(currentTools, activeId)` (read agentRun.js; if inline, extract minimally) or test the route. Assert: with `hasPlugin('healthcare')` true and `toolSchemasFor` returning healthcare schemas, the result is the healthcare tools (incl. `book_appointment`), not banking. With no plugin, the passed-in banking tools are returned unchanged.

```javascript
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  toolSchemasFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../routes/agentRun');

it('uses vertical plugin schemas when a plugin is active', () => {
  dispatch.hasPlugin.mockReturnValue(true);
  dispatch.toolSchemasFor.mockReturnValue([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
  const out = __test.resolveAgentRunTools([{ name: 'get_my_accounts' }], 'healthcare');
  expect(out.map((t) => t.name)).toEqual(['book_appointment']);
});
it('keeps banking tools when no plugin', () => {
  dispatch.hasPlugin.mockReturnValue(false);
  const out = __test.resolveAgentRunTools([{ name: 'get_my_accounts' }], 'banking');
  expect(out.map((t) => t.name)).toEqual(['get_my_accounts']);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Edit `agentRun.js`.** Add the require at top: `const verticalDispatch = require('../services/verticalDispatch');` and `const { verticalManifest } = require('../services/verticalManifest');` (if not already present). Add the helper:

```javascript
// When the active vertical ships a plugin, the external runtime must see the
// vertical's own tool schemas (e.g. book_appointment), not the banking catalog.
function resolveAgentRunTools(currentTools, activeId) {
  return verticalDispatch.hasPlugin(activeId)
    ? verticalDispatch.toolSchemasFor(activeId, () => currentTools)
    : currentTools;
}
```

After the existing `tools = (toolsResult.tools || []).map(...)` block (~line 128), add:

```javascript
    const _activeVerticalId = verticalManifest.resolver.activeId();
    tools = resolveAgentRunTools(tools, _activeVerticalId);
```

Export the helper for testing: add `module.exports.__test = { resolveAgentRunTools };` (or merge into existing exports without breaking the router export — read how the file exports the router first; if it does `module.exports = router`, change to attach `router.__test = {...}` or use a named-export pattern that keeps the router default intact).

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5:** Regression — `cd demo_api_server && npx jest agentRun --no-coverage 2>&1 | tail`. No NEW failures.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/agentRun.js demo_api_server/src/__tests__/agentRun.verticalTools.test.js
git commit --no-verify -m "feat(agents): agentRun sends active vertical's plugin tool schemas to external runtimes"
```

---

## Task 3 — End-to-end verification across runtimes (services running)

- [ ] For each framework (langchain, openai_agents, mastra, pydantic_ai): set `llm_framework`, switch active vertical to healthcare, send "what is my coverage?" via the agent endpoint, confirm the runtime calls `view_coverage` and the BFF returns healthcare data (not "unknown tool", not a banking tool). Document any runtime that still fails.
- [ ] Confirm banking vertical still works on every runtime (no plugin → MCP path unchanged).
- [ ] Regression gate: full unit suite shows no NEW failures vs baseline.

## Done-Criteria

1. `/internal/agent-tool` no longer crashes on `callMcpTool`; executes plugin tools via `verticalDispatch.executeToolFor`, banking tools via `mcpCallTool`.
2. External runtimes receive the active vertical's tool schemas (healthcare LLM can call `book_appointment`/`view_coverage`).
3. All 4 runtimes work in both banking (MCP path) and healthcare (plugin path).
4. No new test failures; auth/token/HITL/tokenEvents behavior preserved.
