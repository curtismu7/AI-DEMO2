# Token Chain Trace Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the token chain display at 8 embed points with a new `TokenChainTraceRail` component that shows the full 11-step agent pipeline (chat prompt → LLM → tokens → exchange → PingOne Authorize → gateway → MCP → API → reply) with full request/response detail per step, and move the 2026 customer dashboard token rail to the right column.

**Architecture:** A UI-side singleton trace store (`tokenChainTraceStore`) merges event sources that already flow to the browser (BFF tokenEvents via `TokenChainContext.setTokenEvents`, flow phases via `agentFlowDiagram` subscription, AG-UI CUSTOM events via `useAgentState`, MCP results via the `mcp-tool-result-sse` window event). A pure `buildTraceSteps(trace)` function derives the step model; dumb components render it. Server work is additive-only: one new `exchangeRequest` field on the existing `exchanged-token` token event (BFF) and one new `llm_detail` CUSTOM AG-UI event (Python agent).

**Tech Stack:** React 18 (JS + JSX, no TS), Vitest + @testing-library/react (UI), Jest (BFF), pytest (Python agent), native `<details>` accordions, CSS with portal brand variables.

**Spec:** `docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md` (approved). Mocks: `2026-07-02-token-chain-trace-rail-mock.html` (rail v3), `2026-07-03-dashboard-2026-layout-mock.html` (layout).

## Global Constraints

- Work in the existing worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/token-inspector-portal-embeds` on branch `worktree-token-inspector-portal-embeds`. Stage files explicitly (`git add <files>`), never `git add -A`.
- **No raw JWT strings in any browser-visible payload.** New server fields must pass through existing scrubbers (`scrubRawJwts` wraps every `/api/mcp/tool` response) and must never embed full token strings — use `eyJ…` placeholder text only.
- No new HTTP endpoints. No changes to authorization/policy logic. No new polling loops.
- Do not modify `UnifiedTokenFlowInspector`'s full-page behavior at `/agent-flow-inspector` (only revert the `embedded` prop added in commit `0e3a9bf89`). Do not modify `TokenChainDisplay` (it stays at `/monitoring/token-chain` and DevTools).
- Styling uses portal brand variables: `--brand-navy`, `--brand-light-gray`, `--brand-medium-gray`; dark header bars use `#16325c` (matches `ExchangeModeToggle`). Token colors: user pink `#f472b6`/`#fce7f3`/`#be185d`, agent purple `#c084fc`/`#e9d5ff`/`#7e22ce`, mcp green `#34d399`/`#d1fae5`/`#047857`.
- UI tests: Vitest with `globals: true` (`vi`, `test`, `expect` are global — no imports), jsdom, `@testing-library/react`. BFF tests: Jest, files in `demo_api_server/tests/*.test.js`. Python tests: pytest in `langchain_agent/tests/`.
- `UserDashboard.js` is frozen by a sha256 canary (`demo_api_ui/src/components/__tests__/UserDashboardPing2026.test.js:309` hashes `../UserDashboard.js`). Any intended edit to `UserDashboard.js` requires re-baselining `FROZEN_SHA256` in that test (the test's comment says to do exactly this).
- Run UI commands from `demo_api_ui/` (symlink `node_modules` from the main checkout if absent: `ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules`). Server tests from `demo_api_server/`. Python tests from `langchain_agent/`.

## File Structure

New files:

- `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — pure: trace object → step array (the 11-step model + conditionals)
- `demo_api_ui/src/services/tokenChainTrace/diffTokenClaims.js` — pure: token claims vs parent → change rows
- `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js` — singleton store (subscribe/ingest/reset)
- `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
- `demo_api_ui/src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js`
- `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
- `demo_api_ui/src/components/TokenChainTraceRail.jsx` — container component
- `demo_api_ui/src/components/TraceStepCard.jsx` — one step `<details>` card (dumb renderer)
- `demo_api_ui/src/components/TraceTokenSummary.jsx` — end-of-flow token summary with change diffs
- `demo_api_ui/src/components/TokenChainTraceRail.css`
- `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`
- `demo_api_server/tests/exchangedTokenEventExchangeRequest.test.js`
- `langchain_agent/tests/agui/test_llm_detail_event.py`

Modified files (task numbers in parentheses):

- `demo_api_ui/src/context/TokenChainContext.js` (5) — one-line ingest hook in `setTokenEvents`
- `demo_api_ui/src/hooks/useAgentState.js` (5) — `CUSTOM`/`llm_detail` case → store
- `demo_api_ui/src/components/AIAgent.js` (5) — `beginTrace(prompt)` at user-message send; (10) TokenChainModal untouched here
- `demo_api_ui/src/components/ExchangeModeToggle.js` (6) — add `hideTable` prop
- `demo_api_server/services/agentMcpTokenService.js` (7) — `exchangeRequest` extra on the completed `exchanged-token` event
- `langchain_agent/src/agui/emitter.py` (8) — `on_llm_detail(...)`
- `langchain_agent/src/api/message_processor.py` (8) — emit on `on_chat_model_end`
- `demo_api_ui/src/components/UserDashboardPing2026.js` (9) — JSX order: rail last in middle + float layouts
- `demo_api_ui/src/components/UserDashboard.css` (9) — 2026-scoped right-rail grid overrides
- `demo_api_ui/src/components/UserDashboard.js` (10) — embed swap ×3
- `demo_api_ui/src/components/Dashboard.js` (10) — embed swap ×1
- `demo_api_ui/src/components/TokenChainModal.js` (10) — tab body swap
- `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx` / `.css` (10) — revert `embedded` prop/CSS
- Test mocks (10): `demo_api_ui/src/components/UserDashboardPing2026.test.js`, `demo_api_ui/src/components/__tests__/UserDashboardPing2026.test.js` (incl. canary re-baseline), `demo_api_ui/src/components/__tests__/buttonRouting.test.js`, `demo_api_ui/src/theme/__tests__/refinedSurface.test.js`

Data-shape reference (used throughout; source: recon of the live code):

- **BFF token event** (built by `agentMcpTokenService.buildTokenEvent:281`): `{ id, label, status, timestamp, alg, claims, explanation, ...extra, jwtFullDecode? }`. Known ids: `user-token`, `exchange`, `exchanged-token`, `exchange-required`, `agent-actor-token`, `session-token-introspection`, `gw-introspection`, `gw-authorize`, `gw-mtls`, `authorize-decision`, `intent-token`.
- **Flow phase row** (`agentFlowDiagram.getState().serverEvents[]`): `{ phase, label, detail, t? }`. Phases include `request_accepted`, `resolving_access_token`, `access_token_ready`, `authorize_gate_begin`, `authorize_permitted`, `authorize_denied`, `mcp_remote_begin`, `mcp_remote_done`, `stream_end`, `mfa_challenge_initiated`, `gateway_policy_denied`.
- **`mcpAuthorizeEvaluation`** (attached to `/api/mcp/tool` success body): `{ engine, decision, path, decisionId, decisionContext, request: {method,url,contentType,body:{parameters}}|null, response: raw|null }`.
- **AG-UI CUSTOM event**: `{ type:'CUSTOM', name, value }` (existing `name:'token_usage'`).
- **`/api/token-chain/current`** → `{ currentTokens: [{ id, timestamp, eventType:'auth'|'exchange', tokenType:'user_token'|'agent_token'|'exchanged_token', tokenSub, tokenAct, tokenAgent, scopes:[], audience, issuer, expiry, description, ... }] }`.
- **MCP result SSE** (window event `mcp-tool-result-sse` detail): `{ tool, result, durationMs, isDelegated, requestJson }`.

---

### Task 1: `buildTraceSteps` — pure step-model builder

**Files:**

- Create: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`

**Interfaces:**

- Consumes: nothing (pure function).
- Produces: `buildTraceSteps(trace) -> Step[]` and exported constant `LANES`.
  - `trace` shape: `{ startedAt: number|null, prompt: {message}|null, llmDetail: {model, request, toolCalls, usage}|null, llmReply: string|null, phases: Array<{phase,label,detail,t}>, tokenEvents: Array<BffTokenEvent>, mcpResult: {tool,result,durationMs,requestJson}|null, authorize: McpAuthorizeEvaluation|null, outcome: 'ok'|'error'|null }`
  - `Step` shape: `{ id: string, num: number, title: string, lane: 'PINGONE'|'CHAT'|'AGENT'|'LLM'|'BFF'|'AUTHZ'|'GATEWAY'|'MCP'|'API', status: 'pending'|'active'|'done'|'error', detail: { narrative?: string, request?: {title,text}, response?: {title,text}, kv?: Array<[string,string]>, scopeDiff?: {before:string[], after:string[]}, decision?: {outcome:'PERMIT'|'DENY'|'STEP_UP'|'INDETERMINATE', label:string}, rfcs?: string[], inspectToken?: 'user'|'agent'|'mcp', tokenEvent?: object } }`

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`:

```js
import { buildTraceSteps } from "../buildTraceSteps";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — empty trace", () => {
  test("returns the 11 happy-path steps, all pending", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    expect(steps.map((s) => s.id)).toEqual([
      "signin", "prompt", "agent", "llm", "agent-token", "exchange",
      "authorize", "gateway", "mcp", "api", "reply",
    ]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps.map((s) => s.num)).toEqual([1,2,3,4,5,6,7,8,9,10,11]);
  });
});

describe("buildTraceSteps — statuses from evidence", () => {
  test("prompt + user-token event mark steps 1-2 done", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      prompt: { message: "transfer $250 to savings" },
      tokenEvents: [{ id: "user-token", label: "User Token", status: "active",
        claims: { sub: "user-123", scope: "read write" } }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.signin.status).toBe("done");
    expect(byId.prompt.status).toBe("done");
    expect(byId.prompt.detail.request.text).toContain("transfer $250 to savings");
    expect(byId.signin.detail.inspectToken).toBe("user");
  });

  test("llmDetail fills the llm step with request/response and kv", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      llmDetail: {
        model: "qwen2.5-14b-instruct",
        request: { messages: [{ role: "system", content: "You are a banking assistant." }] },
        toolCalls: [{ name: "transfer_funds", arguments: { amount: 250 } }],
        usage: { inputTokens: 1842, outputTokens: 61 },
      },
    });
    const llm = steps.find((s) => s.id === "llm");
    expect(llm.status).toBe("done");
    expect(llm.lane).toBe("LLM");
    expect(llm.detail.request.text).toContain("banking assistant");
    expect(llm.detail.response.text).toContain("transfer_funds");
    expect(llm.detail.kv).toContainEqual(["tokens used", "prompt 1842 · completion 61"]);
  });

  test("exchanged-token event fills exchange step with scope diff and act proof", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active", claims: { scope: "read write" } },
        { id: "exchanged-token", status: "active",
          claims: { sub: "user-123", scope: "write", aud: "mcp-gw", act: { sub: "agent-001" } },
          scopeNarrowed: true, audienceNarrowed: true,
          exchangeRequest: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            scope: "write", audience: "mcp-gw" } },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("done");
    expect(ex.detail.scopeDiff).toEqual({ before: ["read", "write"], after: ["write"] });
    expect(ex.detail.request.text).toContain("token-exchange");
    expect(ex.detail.inspectToken).toBe("mcp");
    expect(ex.detail.rfcs).toContain("RFC 8693");
  });

  test("authorize evaluation fills authorize step with decision + full request", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: {
        engine: "pingone", decision: "PERMIT", decisionId: "dec_8f31",
        decisionContext: "McpFirstTool",
        request: { method: "POST",
          url: "https://api.pingone.com/v1/environments/e1/decisionEndpoints/d1",
          body: { parameters: { UserId: "user-123", ToolName: "transfer_funds", Amount: 250 } } },
        response: { decision: "PERMIT", id: "dec_8f31" },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("done");
    expect(az.detail.decision).toEqual({ outcome: "PERMIT",
      label: "PERMIT — pingone (McpFirstTool)" });
    expect(az.detail.request.text).toContain("decisionEndpoints/d1");
    expect(az.detail.request.text).toContain("transfer_funds");
    expect(az.detail.kv).toContainEqual(["decision id", "dec_8f31"]);
  });

  test("authorize_denied phase renders authorize step as error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", label: "Authorize denied", detail: "" }],
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("error");
  });

  test("mfa_challenge_initiated inserts conditional step-up step after authorize", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "mfa_challenge_initiated", label: "HITL — MFA challenge", detail: "" }],
    });
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf("stepup")).toBe(ids.indexOf("authorize") + 1);
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  test("gw-authorize token event fills gateway step checks", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", status: "active",
        decision: "PERMIT", url: "https://gw/authz", statements: [] }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("done");
    expect(gw.detail.kv.some(([k]) => k === "authorize")).toBe(true);
  });

  test("mcpResult fills mcp and api steps; llmReply fills reply", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: { tool: "transfer_funds", durationMs: 412,
        requestJson: { name: "transfer_funds", arguments: { amount: 250 } },
        result: { transactionId: "txn_9d2e", status: "posted" } },
      llmReply: "Done! I transferred $250.",
      phases: [{ phase: "mcp_remote_done", label: "done", detail: "" }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.mcp.status).toBe("done");
    expect(byId.mcp.detail.request.text).toContain("transfer_funds");
    expect(byId.api.detail.response.text).toContain("txn_9d2e");
    expect(byId.reply.status).toBe("done");
    expect(byId.reply.detail.response.text).toContain("Done!");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `demo_api_ui/`): `npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
Expected: FAIL — cannot resolve `../buildTraceSteps`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`:

```js
// Pure derivation: merged trace evidence -> ordered step model for the
// TokenChainTraceRail. No I/O, no store access — unit-testable in isolation.

export const LANES = {
  signin: "PINGONE", prompt: "CHAT", agent: "AGENT", llm: "LLM",
  "agent-token": "BFF", exchange: "BFF", authorize: "AUTHZ", stepup: "AUTHZ",
  gateway: "GATEWAY", mcp: "MCP", api: "API", reply: "LLM",
};

const TITLES = {
  signin: "Sign-in — User Token acquired",
  prompt: "Chatbot — prompt sent",
  agent: "Agent service receives request",
  llm: "LLM — reasoning & tool choice",
  "agent-token": "Agent identity token",
  exchange: "Token exchange — delegation",
  authorize: "PingOne Authorize — policy decision",
  stepup: "Step-up required — HITL / MFA",
  gateway: "Agent Gateway — token validated",
  mcp: "MCP server — tool executes",
  api: "Resource server — API call",
  reply: "LLM composes reply → chat",
};

const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const splitScopes = (s) =>
  Array.isArray(s) ? s : typeof s === "string" ? s.split(" ").filter(Boolean) : [];
const findEvent = (events, id) => events.find((e) => e && e.id === id) || null;
const hasPhase = (phases, name) => phases.some((p) => p && p.phase === name);

function makeStep(id, status, detail) {
  return { id, title: TITLES[id], lane: LANES[id], status, detail: detail || {} };
}

export function buildTraceSteps(trace) {
  const { prompt, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize } = trace;
  const steps = [];

  // 1. signin — evidence: user-token / session-token-introspection events
  const userTok = findEvent(tokenEvents, "user-token") ||
    findEvent(tokenEvents, "session-token-introspection");
  steps.push(makeStep("signin", userTok ? "done" : "pending", userTok ? {
    narrative: "User authenticated via OIDC Authorization Code + PKCE. The BFF holds the User Token server-side — it never reaches the browser.",
    kv: Object.entries(userTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    rfcs: ["RFC 6749", "RFC 7636"],
    inspectToken: "user",
    tokenEvent: userTok,
  } : {}));

  // 2. prompt
  steps.push(makeStep("prompt", prompt ? "done" : "pending", prompt ? {
    narrative: "The browser sends only the message — no tokens; the session cookie identifies the user to the BFF.",
    request: { title: "Request (actual)",
      text: `POST /api/agent/run\n${asJson({ message: prompt.message })}` },
  } : {}));

  // 3. agent — evidence: request_accepted phase or any activity at all
  const agentSeen = hasPhase(phases, "request_accepted") || !!llmDetail;
  steps.push(makeStep("agent", agentSeen ? "done" : "pending", agentSeen ? {
    narrative: "BFF forwards to the agent. The agent loads conversation history and the gateway tool catalog (with required scopes), then prepares the LLM call.",
  } : {}));

  // 4. llm
  steps.push(makeStep("llm", llmDetail ? "done" : "pending", llmDetail ? {
    narrative: "The agent sends the conversation to the LLM. The model returns a tool call — it never sees or holds any OAuth token.",
    request: { title: "LLM request (actual)",
      text: `model: ${llmDetail.model || "?"}\n${asJson(llmDetail.request || {})}` },
    response: { title: "LLM response — tool call", text: asJson(llmDetail.toolCalls || []) },
    kv: llmDetail.usage
      ? [["tokens used", `prompt ${llmDetail.usage.inputTokens} · completion ${llmDetail.usage.outputTokens}`]]
      : [],
  } : {}));

  // 5. agent-token
  const agentTok = findEvent(tokenEvents, "agent-actor-token");
  steps.push(makeStep("agent-token", agentTok ? "done" : "pending", agentTok ? {
    narrative: "BFF obtains a client-credentials token — the agent's own identity, separate from the user's.",
    kv: Object.entries(agentTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    inspectToken: "agent",
    tokenEvent: agentTok,
  } : {}));

  // 6. exchange
  const exTok = findEvent(tokenEvents, "exchanged-token");
  const exFailed = findEvent(tokenEvents, "exchange-failed");
  const exDone = exTok && exTok.status !== "waiting";
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : exTok ? "active" : "pending",
    exDone ? {
      narrative: "BFF exchanges subject (user) + actor (agent) for one delegated token: proof the agent acts FOR this user. Scope narrows to what the tool needs; audience binds to the gateway.",
      request: exTok.exchangeRequest
        ? { title: "Exchange request (actual)", text: asJson(exTok.exchangeRequest) }
        : undefined,
      response: { title: "Delegated token claims", text: asJson(exTok.claims || {}) },
      scopeDiff: beforeScopes.length || afterScopes.length
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: exTok.claims && exTok.claims.act
        ? [["act chain", asJson(exTok.claims.act)]] : [],
      rfcs: ["RFC 8693", "RFC 8707"],
      inspectToken: "mcp",
      tokenEvent: exTok,
    } : {}));

  // 7. authorize
  const azDenied = hasPhase(phases, "authorize_denied");
  const azPermitted = hasPhase(phases, "authorize_permitted") || (authorize && authorize.decision === "PERMIT");
  const azBegun = hasPhase(phases, "authorize_gate_begin");
  steps.push(makeStep("authorize",
    azDenied ? "error" : azPermitted ? "done" : azBegun ? "active" : "pending",
    authorize ? {
      narrative: "Before any tool runs, the BFF asks PingOne Authorize whether THIS user + agent may perform THIS action.",
      request: authorize.request ? { title: "Decision request (actual)",
        text: `${authorize.request.method || "POST"} ${authorize.request.url || ""}\n${asJson((authorize.request.body || {}).parameters || authorize.request.body || {})}` } : undefined,
      response: authorize.response
        ? { title: "Decision response (raw)", text: asJson(authorize.response) } : undefined,
      decision: { outcome: authorize.decision || "INDETERMINATE",
        label: `${authorize.decision || "INDETERMINATE"} — ${authorize.engine || "?"}${authorize.decisionContext ? ` (${authorize.decisionContext})` : ""}` },
      kv: [
        ["engine", String(authorize.engine || "")],
        ["decision id", String(authorize.decisionId || "")],
      ].filter(([, v]) => v),
    } : {}));

  // 7a. step-up (conditional)
  const stepUpStarted = hasPhase(phases, "mfa_challenge_initiated");
  const stepUpDone = hasPhase(phases, "mfa_challenge_completed");
  const stepUpFailed = hasPhase(phases, "mfa_challenge_failed");
  if (stepUpStarted || stepUpDone || stepUpFailed) {
    steps.push(makeStep("stepup",
      stepUpFailed ? "error" : stepUpDone ? "done" : "active", {
        narrative: "The policy demanded step-up: the human must approve (HITL/CIBA/MFA) before the tool call proceeds.",
        kv: phases.filter((p) => p.phase.startsWith("mfa_challenge"))
          .map((p) => [p.phase, p.label || ""]),
      }));
  }

  // 8. gateway
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  const gwIntro = findEvent(tokenEvents, "gw-introspection");
  const gwDenied = hasPhase(phases, "gateway_policy_denied");
  steps.push(makeStep("gateway",
    gwDenied ? "error" : (gwAz || gwIntro) ? "done" : "pending",
    (gwAz || gwIntro) ? {
      narrative: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: introspection, audience binding, scope, delegation chain.",
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", asJson(gwAz.statements)] : null,
      ].filter(Boolean),
      response: gwAz && gwAz.rawResponse
        ? { title: "Gateway authorize response", text: asJson(gwAz.rawResponse) } : undefined,
    } : {}));

  // 9. mcp + 10. api
  const mcpDone = hasPhase(phases, "mcp_remote_done") || !!(mcpResult && mcpResult.result);
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  steps.push(makeStep("mcp", mcpDone ? "done" : mcpBegun ? "active" : "pending",
    mcpResult ? {
      narrative: "Gateway forwards the JSON-RPC call; the MCP server re-validates the token, resolves the user from sub, and invokes the banking API with the delegated identity.",
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      kv: mcpResult.durationMs != null ? [["duration", `${mcpResult.durationMs} ms`]] : [],
    } : {}));
  steps.push(makeStep("api", mcpDone && mcpResult ? "done" : "pending",
    mcpResult && mcpResult.result ? {
      narrative: "The actual resource-server call made with the delegated bearer token.",
      response: { title: "API result", text: asJson(mcpResult.result) },
    } : {}));

  // 11. reply
  steps.push(makeStep("reply", llmReply ? "done" : "pending", llmReply ? {
    narrative: "The tool result goes back to the LLM, which writes the reply the user sees in the chat.",
    response: { title: "Streamed reply", text: String(llmReply) },
  } : {}));

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js
git commit -m "feat(trace-rail): pure buildTraceSteps step-model builder"
```

---

### Task 2: `diffTokenClaims` — token change rows

**Files:**

- Create: `demo_api_ui/src/services/tokenChainTrace/diffTokenClaims.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js`

**Interfaces:**

- Produces: `diffTokenClaims(parentClaims, childClaims) -> Array<{claim:string, from:string, to:string, note:string}>` — compares `scope`, `aud`, `act`, `exp`; returns only changed rows. Used by `TraceTokenSummary` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js`:

```js
import { diffTokenClaims } from "../diffTokenClaims";

test("detects scope narrowing", () => {
  const rows = diffTokenClaims({ scope: "read write" }, { scope: "write" });
  expect(rows).toContainEqual({ claim: "scope", from: "read write", to: "write", note: "narrowed" });
});

test("detects audience rebinding", () => {
  const rows = diffTokenClaims({ aud: "banking-api" }, { aud: "mcp-gw" });
  expect(rows).toContainEqual({ claim: "aud", from: "banking-api", to: "mcp-gw", note: "rebound (RFC 8707)" });
});

test("detects act added", () => {
  const rows = diffTokenClaims({}, { act: { sub: "agent-001" } });
  expect(rows).toContainEqual({
    claim: "act", from: "—", to: '{"sub":"agent-001"}', note: "delegation proof added (RFC 8693)",
  });
});

test("detects exp shortened, ignores unchanged claims", () => {
  const rows = diffTokenClaims({ exp: 1000, scope: "write" }, { exp: 500, scope: "write" });
  expect(rows).toEqual([{ claim: "exp", from: "1000", to: "500", note: "shortened" }]);
});

test("returns empty array when nothing changed", () => {
  expect(diffTokenClaims({ scope: "a" }, { scope: "a" })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js`
Expected: FAIL — cannot resolve `../diffTokenClaims`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/services/tokenChainTrace/diffTokenClaims.js`:

```js
// Compares the security-relevant claims of a token against its parent in the
// delegation chain. Returns only CHANGED rows, with a teaching note.

const str = (v) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function diffTokenClaims(parentClaims = {}, childClaims = {}) {
  const rows = [];

  if (str(parentClaims.scope) !== str(childClaims.scope)) {
    const before = String(parentClaims.scope || "").split(" ").filter(Boolean);
    const after = String(childClaims.scope || "").split(" ").filter(Boolean);
    rows.push({ claim: "scope", from: str(parentClaims.scope), to: str(childClaims.scope),
      note: after.length && after.length < before.length ? "narrowed" : "changed" });
  }
  if (str(parentClaims.aud) !== str(childClaims.aud)) {
    rows.push({ claim: "aud", from: str(parentClaims.aud), to: str(childClaims.aud),
      note: "rebound (RFC 8707)" });
  }
  if (str(parentClaims.act) !== str(childClaims.act)) {
    rows.push({ claim: "act", from: str(parentClaims.act), to: str(childClaims.act),
      note: childClaims.act && !parentClaims.act
        ? "delegation proof added (RFC 8693)" : "changed" });
  }
  if (parentClaims.exp != null && childClaims.exp != null &&
      Number(parentClaims.exp) !== Number(childClaims.exp)) {
    rows.push({ claim: "exp", from: str(parentClaims.exp), to: str(childClaims.exp),
      note: Number(childClaims.exp) < Number(parentClaims.exp) ? "shortened" : "extended" });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/diffTokenClaims.js demo_api_ui/src/services/tokenChainTrace/__tests__/diffTokenClaims.test.js
git commit -m "feat(trace-rail): diffTokenClaims change-row derivation"
```

---

### Task 3: `tokenChainTraceStore` — singleton store

**Files:**

- Create: `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`

**Interfaces:**

- Consumes: `buildTraceSteps` (Task 1).
- Produces singleton `tokenChainTraceStore` with:
  - `subscribe(fn) -> unsubscribe` (fn called immediately with snapshot, then on change)
  - `getState() -> { trace, steps }` (`steps` = `buildTraceSteps(trace)`)
  - `beginTrace({ prompt }) -> void` (resets trace, sets `startedAt`, `prompt`)
  - `ingestPhases(serverEvents) -> void` (replaces `trace.phases`; auto-begins a trace if none active)
  - `ingestTokenEvents(events) -> void` (replaces `trace.tokenEvents` when non-empty)
  - `ingestAuthorize(evaluation) -> void`
  - `ingestLlmDetail(value) -> void`
  - `ingestLlmReply(text) -> void`
  - `ingestMcpResult(payload) -> void`
  - `completeTrace(ok) -> void` (sets `outcome`)
  - `reset() -> void`
- Also self-wires two passive listeners on module init (idempotent): `agentFlowDiagram.subscribe(snap => ingestPhases(snap.serverEvents))` and `window.addEventListener('mcp-tool-result-sse', e => ingestMcpResult(e.detail))`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`:

```js
import { tokenChainTraceStore } from "../tokenChainTraceStore";

beforeEach(() => tokenChainTraceStore.reset());

test("beginTrace resets state and stores prompt", () => {
  tokenChainTraceStore.ingestLlmReply("old");
  tokenChainTraceStore.beginTrace({ prompt: "transfer $250" });
  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.prompt).toEqual({ message: "transfer $250" });
  expect(trace.llmReply).toBeNull();
  expect(steps.find((s) => s.id === "prompt").status).toBe("done");
});

test("subscribe fires immediately and on ingest", () => {
  const seen = [];
  const unsub = tokenChainTraceStore.subscribe((snap) => seen.push(snap.steps.length));
  expect(seen).toHaveLength(1);
  tokenChainTraceStore.ingestTokenEvents([{ id: "user-token", status: "active", claims: {} }]);
  expect(seen).toHaveLength(2);
  unsub();
  tokenChainTraceStore.ingestLlmReply("hi");
  expect(seen).toHaveLength(2);
});

test("ingestTokenEvents ignores empty arrays (keeps last good set)", () => {
  tokenChainTraceStore.ingestTokenEvents([{ id: "user-token", status: "active" }]);
  tokenChainTraceStore.ingestTokenEvents([]);
  expect(tokenChainTraceStore.getState().trace.tokenEvents).toHaveLength(1);
});

test("ingestAuthorize + ingestMcpResult reach the step model", () => {
  tokenChainTraceStore.ingestAuthorize({ engine: "pingone", decision: "PERMIT", decisionId: "d1" });
  tokenChainTraceStore.ingestMcpResult({ tool: "t", result: { ok: 1 }, durationMs: 5 });
  const byId = Object.fromEntries(
    tokenChainTraceStore.getState().steps.map((s) => [s.id, s]));
  expect(byId.authorize.detail.decision.outcome).toBe("PERMIT");
  expect(byId.api.status).toBe("done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: FAIL — cannot resolve `../tokenChainTraceStore`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`:

```js
// Singleton trace store for the TokenChainTraceRail. Mirrors the subscribe/
// getState pattern of agentFlowDiagramService. Ingest methods are called from
// the existing event funnels (TokenChainContext, useAgentState, AIAgent) and
// from two passive listeners wired below.
import { buildTraceSteps } from "./buildTraceSteps";
import { agentFlowDiagram } from "../agentFlowDiagramService";

const EMPTY_TRACE = () => ({
  startedAt: null, prompt: null, llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
});

let trace = EMPTY_TRACE();
const listeners = new Set();

function emit() {
  const snap = getState();
  listeners.forEach((fn) => { try { fn(snap); } catch { /* listener errors are theirs */ } });
}

function getState() {
  return { trace: { ...trace }, steps: buildTraceSteps(trace) };
}

function ensureTrace() {
  if (trace.startedAt == null) trace.startedAt = Date.now();
}

export const tokenChainTraceStore = {
  subscribe(fn) { listeners.add(fn); fn(getState()); return () => listeners.delete(fn); },
  getState,
  beginTrace({ prompt } = {}) {
    trace = EMPTY_TRACE();
    trace.startedAt = Date.now();
    trace.prompt = prompt ? { message: String(prompt) } : null;
    emit();
  },
  ingestPhases(serverEvents) {
    if (!Array.isArray(serverEvents) || !serverEvents.length) return;
    ensureTrace();
    trace.phases = serverEvents.slice();
    emit();
  },
  ingestTokenEvents(events) {
    if (!Array.isArray(events) || !events.length) return;
    ensureTrace();
    trace.tokenEvents = events.slice();
    emit();
  },
  ingestAuthorize(evaluation) {
    if (!evaluation) return;
    ensureTrace();
    trace.authorize = evaluation;
    emit();
  },
  ingestLlmDetail(value) {
    if (!value) return;
    ensureTrace();
    trace.llmDetail = value;
    emit();
  },
  ingestLlmReply(text) {
    if (!text) return;
    ensureTrace();
    trace.llmReply = String(text);
    emit();
  },
  ingestMcpResult(payload) {
    if (!payload) return;
    ensureTrace();
    trace.mcpResult = payload;
    emit();
  },
  completeTrace(ok) { trace.outcome = ok ? "ok" : "error"; emit(); },
  reset() { trace = EMPTY_TRACE(); emit(); },
};

// Passive wiring — phases stream through agentFlowDiagram already; MCP results
// arrive on a window event fired by TokenChainContext's SSE handler.
agentFlowDiagram.subscribe((snap) => {
  if (snap && Array.isArray(snap.serverEvents) && snap.serverEvents.length) {
    tokenChainTraceStore.ingestPhases(snap.serverEvents);
  }
});
if (typeof window !== "undefined") {
  window.addEventListener("mcp-tool-result-sse", (e) => {
    if (e && e.detail) tokenChainTraceStore.ingestMcpResult(e.detail);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: PASS (4 tests). Note: importing the store imports `agentFlowDiagramService` — it is plain JS with no DOM requirements beyond `window` guards, safe under jsdom.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js
git commit -m "feat(trace-rail): tokenChainTraceStore singleton with passive wiring"
```

---

### Task 4: `TokenChainTraceRail` component family

**Files:**

- Create: `demo_api_ui/src/components/TraceStepCard.jsx`
- Create: `demo_api_ui/src/components/TraceTokenSummary.jsx`
- Create: `demo_api_ui/src/components/TokenChainTraceRail.jsx`
- Create: `demo_api_ui/src/components/TokenChainTraceRail.css`
- Test: `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`

**Interfaces:**

- Consumes: `tokenChainTraceStore` (Task 3), `diffTokenClaims` (Task 2), `ClaimDetailsModal({ isOpen, tokenType, onClose })`, `TokenLegendModal({ isOpen, onClose })`.
- Produces: `export default function TokenChainTraceRail()` — no props. `TraceStepCard({ step, onInspect })`. `TraceTokenSummary({ tokenEvents })`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import TokenChainTraceRail from "../TokenChainTraceRail";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../ClaimDetailsModal", () => ({
  default: ({ isOpen, tokenType }) =>
    isOpen ? <div data-testid="claims-modal">{tokenType}</div> : null,
}));
vi.mock("../TokenLegendModal", () => ({
  default: ({ isOpen }) => (isOpen ? <div data-testid="legend-modal" /> : null),
}));

beforeEach(() => tokenChainTraceStore.reset());

test("renders header, chain line, and all 11 collapsed steps by default", () => {
  render(<TokenChainTraceRail />);
  expect(screen.getByText(/Token Chain/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /legend/i })).toBeInTheDocument();
  // 11 step titles present, none expanded (no step body text visible)
  expect(screen.getByText(/Sign-in — User Token acquired/)).toBeInTheDocument();
  expect(screen.getByText(/LLM composes reply/)).toBeInTheDocument();
  expect(document.querySelectorAll("details.tctr-step[open]")).toHaveLength(0);
  // Exchange Mode Details reference accordion present (collapsed)
  expect(screen.getByText(/Exchange Mode Details/)).toBeInTheDocument();
});

test("steps update from the store and expand to show detail", () => {
  render(<TokenChainTraceRail />);
  tokenChainTraceStore.beginTrace({ prompt: "transfer $250 to savings" });
  const promptStep = screen.getByText(/Chatbot — prompt sent/).closest("details");
  fireEvent.click(promptStep.querySelector("summary"));
  expect(promptStep).toHaveAttribute("open");
  expect(promptStep.textContent).toContain("transfer $250 to savings");
});

test("legend button opens the legend modal; inspect opens claims modal", () => {
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("button", { name: /legend/i }));
  expect(screen.getByTestId("legend-modal")).toBeInTheDocument();

  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
  ]);
  const signin = screen.getByText(/Sign-in — User Token acquired/).closest("details");
  fireEvent.click(signin.querySelector("summary"));
  fireEvent.click(screen.getByRole("button", { name: /inspect claims/i }));
  expect(screen.getByTestId("claims-modal")).toHaveTextContent("user");
});

test("token summary accordion lists tokens with change rows", () => {
  render(<TokenChainTraceRail />);
  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", label: "User Token",
      claims: { sub: "u1", scope: "read write", aud: "banking-api" } },
    { id: "exchanged-token", status: "active", label: "Delegated Token",
      claims: { sub: "u1", scope: "write", aud: "mcp-gw", act: { sub: "agent-001" } } },
  ]);
  const summary = screen.getByText(/Token Summary/).closest("details");
  fireEvent.click(summary.querySelector("summary"));
  expect(summary.textContent).toContain("Delegated Token");
  expect(summary.textContent).toContain("narrowed");
  expect(summary.textContent).toContain("rebound");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: FAIL — cannot resolve `../TokenChainTraceRail`.

- [ ] **Step 3: Create `TraceStepCard.jsx`**

```jsx
// One pipeline step — a native <details> card. Dumb renderer over the neutral
// step.detail shape produced by buildTraceSteps; knows nothing about sources.
import React from "react";

const STATUS_ICON = { pending: "·", active: "⏳", done: "✓", error: "✗" };

export default function TraceStepCard({ step, onInspect }) {
  const d = step.detail || {};
  return (
    <details className="tctr-step" data-status={step.status}>
      <summary>
        <span className={`tctr-ic tctr-ic--${step.status}`}>{STATUS_ICON[step.status]}</span>
        <span className="tctr-step-title">{step.num}. {step.title}</span>
        <span className={`tctr-lane tctr-lane--${step.lane.toLowerCase()}`}>{step.lane}</span>
      </summary>
      <div className="tctr-step-body">
        {d.narrative && <p className="tctr-narrative">{d.narrative}</p>}
        {d.request && (
          <>
            <h4>{d.request.title}</h4>
            <pre className="tctr-code">{d.request.text}</pre>
          </>
        )}
        {d.response && (
          <>
            <h4>{d.response.title}</h4>
            <pre className="tctr-code">{d.response.text}</pre>
          </>
        )}
        {d.decision && (
          <div className={`tctr-decision tctr-decision--${d.decision.outcome.toLowerCase()}`}>
            {d.decision.outcome === "PERMIT" ? "✓" : "✗"} {d.decision.label}
          </div>
        )}
        {d.scopeDiff && (
          <div className="tctr-scope-diff">
            {d.scopeDiff.before.map((s) => (
              <span key={`b-${s}`}
                className={d.scopeDiff.after.includes(s) ? "tctr-sc tctr-sc--kept" : "tctr-sc tctr-sc--gone"}>
                {s}
              </span>
            ))}
            <span className="tctr-sc-note">← scope after exchange: {d.scopeDiff.after.join(" ") || "(none)"}</span>
          </div>
        )}
        {Array.isArray(d.kv) && d.kv.length > 0 && (
          <div className="tctr-kv">
            {d.kv.map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="tctr-kv-k">{k}</span>
                <span className="tctr-kv-v">{v}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {Array.isArray(d.rfcs) && d.rfcs.map((r) => (
          <span key={r} className="tctr-rfc">{r}</span>
        ))}
        {d.inspectToken && (
          <button type="button" className="tctr-inspect"
            onClick={() => onInspect(d.inspectToken)}>
            → Inspect claims
          </button>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Create `TraceTokenSummary.jsx`**

```jsx
// End-of-flow token summary: every token seen in the trace, with its claims
// and how it changed vs its parent in the delegation chain.
import React from "react";
import { diffTokenClaims } from "../services/tokenChainTrace/diffTokenClaims";

// Chain order + display metadata. exchanged-token's parent is user-token.
const TOKEN_META = {
  "user-token": { name: "User Token", cls: "user", role: "subject_token", parent: null, inspect: "user" },
  "agent-actor-token": { name: "Agent Token", cls: "agent", role: "actor_token", parent: null, inspect: "agent" },
  "exchanged-token": { name: "Delegated Token", cls: "mcp", role: "act chain", parent: "user-token", inspect: "mcp" },
};

export default function TraceTokenSummary({ tokenEvents, onInspect }) {
  const byId = Object.fromEntries((tokenEvents || []).map((e) => [e.id, e]));
  const tokens = Object.keys(TOKEN_META).map((id) => byId[id] && { id, evt: byId[id] }).filter(Boolean);
  if (!tokens.length) return null;

  return (
    <details className="tctr-acc">
      <summary><span className="tctr-chev">▶</span> Token Summary
        <span className="tctr-count">{tokens.length}</span></summary>
      <div className="tctr-acc-body">
        {tokens.map(({ id, evt }) => {
          const meta = TOKEN_META[id];
          const parent = meta.parent ? byId[meta.parent] : null;
          const changes = parent ? diffTokenClaims(parent.claims || {}, evt.claims || {}) : [];
          return (
            <div key={id} className={`tctr-tok tctr-tok--${meta.cls}`}>
              <button type="button" className="tctr-tok-inspect" onClick={() => onInspect(meta.inspect)}>
                Inspect
              </button>
              <div className="tctr-tok-head">
                <span className="tctr-tok-name">{evt.label || meta.name}</span>
                <span className="tctr-tok-role">{meta.role}</span>
              </div>
              <div className="tctr-tok-claims">
                {Object.entries(evt.claims || {}).slice(0, 6)
                  .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                  .join(" · ")}
              </div>
              {changes.length > 0 && (
                <div className="tctr-tok-changes">
                  {changes.map((c) => (
                    <div key={c.claim} className="tctr-tok-change">
                      <span className="tctr-kv-k">{c.claim}</span>
                      <span className="tctr-kv-v">{c.from} → {c.to} <em>({c.note})</em></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
```

- [ ] **Step 5: Create `TokenChainTraceRail.jsx`**

```jsx
// Compact full-pipeline trace rail for the portal token rails and the agent
// TokenChainModal. Single-column by construction (no viewport media queries).
// Spec: docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md
import React, { useEffect, useState, useCallback } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";
import ClaimDetailsModal from "./ClaimDetailsModal";
import TokenLegendModal from "./TokenLegendModal";
import "./TokenChainTraceRail.css";

const CHAIN_DOTS = [
  { cls: "user", label: "User" },
  { cls: "agent", label: "Agent" },
  { cls: "mcp", label: "MCP" },
];

export default function TokenChainTraceRail() {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  const [legendOpen, setLegendOpen] = useState(false);
  const [inspectType, setInspectType] = useState(null);

  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  const onInspect = useCallback((tokenType) => setInspectType(tokenType), []);

  const { steps, trace } = snap;

  return (
    <div className="tctr">
      <div className="tctr-head">
        <span className="tctr-title">🔗 Token Chain</span>
        <button type="button" className="tctr-legend-btn" onClick={() => setLegendOpen(true)}>
          Legend
        </button>
      </div>

      <div className="tctr-chain-line">
        {CHAIN_DOTS.map((d, i) => (
          <React.Fragment key={d.cls}>
            {i > 0 && <span className="tctr-arrow">→</span>}
            <span className={`tctr-dot tctr-dot--${d.cls}`} /> {d.label}
          </React.Fragment>
        ))}
        <span className="tctr-badge">CHAINED</span>
      </div>

      <div className="tctr-sec-label">
        {trace.prompt ? `Pipeline — "${trace.prompt.message}"` : "Pipeline — awaiting agent action"}
      </div>

      {steps.map((step) => (
        <TraceStepCard key={step.id} step={step} onInspect={onInspect} />
      ))}

      <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} />

      {/* Role reference table — content that left ExchangeModeToggle (hideTable) */}
      <details className="tctr-acc">
        <summary><span className="tctr-chev">▶</span> Exchange Mode Details</summary>
        <div className="tctr-acc-body">
          <div className="tctr-kv" style={{ gridTemplateColumns: "70px 1fr" }}>
            <span className="tctr-kv-k" style={{ color: "#be185d" }}>User</span>
            <span className="tctr-kv-v">PingOne OIDC login → subject_token (RFC 8693 §1.1)</span>
            <span className="tctr-kv-k" style={{ color: "#7e22ce" }}>Agent</span>
            <span className="tctr-kv-v">client credentials → actor_token (RFC 8693 §1.1)</span>
            <span className="tctr-kv-k" style={{ color: "#047857" }}>MCP</span>
            <span className="tctr-kv-v">RFC 8693 exchange → delegated token with nested act claim</span>
          </div>
        </div>
      </details>

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 6: Create `TokenChainTraceRail.css`**

```css
/* TokenChainTraceRail — portal-brand styling, single-column by construction.
 * Dark header bars match ExchangeModeToggle (#16325c). */
.tctr {
  background: #fff;
  font-size: 12.5px;
  color: #0f172a;
}

.tctr-head {
  background: #16325c;
  color: #fff;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tctr-title { font-size: 13px; font-weight: 700; }
.tctr-legend-btn {
  background: none; border: 1px solid rgba(255, 255, 255, 0.35); color: #e2e8f0;
  font-size: 11px; border-radius: 5px; padding: 3px 8px; cursor: pointer;
}

.tctr-chain-line {
  display: flex; align-items: center; gap: 6px; padding: 10px 12px;
  border-bottom: 1px solid #e8eef7; font-weight: 600; flex-wrap: wrap;
}
.tctr-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.tctr-dot--user { background: #f472b6; }
.tctr-dot--agent { background: #c084fc; }
.tctr-dot--mcp { background: #34d399; }
.tctr-arrow { color: #94a3b8; font-weight: 400; }
.tctr-badge {
  margin-left: auto; background: var(--brand-navy, #1d4ed8); color: #fff;
  font-size: 10.5px; padding: 2px 8px; border-radius: 999px; font-weight: 700;
}

.tctr-sec-label {
  font-size: 10.5px; font-weight: 700; color: #64748b; text-transform: uppercase;
  letter-spacing: 0.06em; padding: 8px 12px 2px;
}

/* Step cards */
.tctr-step { border-bottom: 1px dashed #eef2f9; }
.tctr-step > summary {
  list-style: none; display: flex; align-items: center; gap: 7px;
  padding: 7px 12px; cursor: pointer; font-size: 12px;
}
.tctr-step > summary::-webkit-details-marker { display: none; }
.tctr-ic { width: 15px; text-align: center; flex-shrink: 0; }
.tctr-ic--done { color: #16a34a; }
.tctr-ic--active { color: var(--brand-navy, #1d4ed8); }
.tctr-ic--pending { color: #cbd5e1; }
.tctr-ic--error { color: #dc2626; }
.tctr-step-title { flex: 1; min-width: 0; }
.tctr-step[data-status="error"] > summary { color: #b91c1c; }

.tctr-lane {
  font-size: 9px; font-weight: 800; letter-spacing: 0.04em; border-radius: 4px;
  padding: 1px 5px; flex: 0 0 auto; align-self: center; white-space: nowrap;
}
.tctr-lane--pingone { background: #dbeafe; color: #1e40af; }
.tctr-lane--chat { background: #fce7f3; color: #9d174d; }
.tctr-lane--agent { background: #e9d5ff; color: #7e22ce; }
.tctr-lane--llm { background: #ede9fe; color: #5b21b6; }
.tctr-lane--bff { background: #f1f5f9; color: #334155; }
.tctr-lane--authz { background: #fef3c7; color: #92400e; }
.tctr-lane--gateway { background: #cffafe; color: #0e7490; }
.tctr-lane--mcp { background: #d1fae5; color: #047857; }
.tctr-lane--api { background: #fee2e2; color: #b91c1c; }

.tctr-step-body {
  padding: 10px 12px 12px 24px; font-size: 12px; color: #334155;
  background: var(--brand-light-gray, #f8fafc); border-top: 1px solid #eef2f9;
}
.tctr-step-body h4 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em;
  color: #64748b; margin: 10px 0 4px; font-weight: 700;
}
.tctr-narrative { margin: 0 0 4px; }
.tctr-code {
  background: #0f172a; color: #bae6fd; font-size: 10.5px; padding: 8px;
  border-radius: 6px; margin: 4px 0; overflow-x: auto; line-height: 1.5;
  font-family: ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-word;
}
.tctr-kv { display: grid; grid-template-columns: 92px 1fr; gap: 3px 8px; font-size: 11px; margin: 4px 0; }
.tctr-kv-k { color: #64748b; font-weight: 600; }
.tctr-kv-v { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; word-break: break-all; }
.tctr-rfc {
  display: inline-block; background: #e0e7ff; color: #3730a3; border-radius: 4px;
  font-size: 9.5px; font-weight: 700; padding: 1px 5px; margin: 4px 3px 0 0;
}
.tctr-decision { border-radius: 6px; padding: 6px 9px; font-size: 11.5px; font-weight: 700; margin: 4px 0; }
.tctr-decision--permit { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.tctr-decision--deny, .tctr-decision--indeterminate { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.tctr-decision--step_up { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.tctr-scope-diff { display: flex; gap: 6px; align-items: center; font-family: ui-monospace, Menlo, monospace; font-size: 11px; flex-wrap: wrap; margin: 4px 0; }
.tctr-sc { border-radius: 4px; padding: 1px 6px; background: #e2e8f0; }
.tctr-sc--gone { text-decoration: line-through; color: #94a3b8; }
.tctr-sc--kept { background: #dcfce7; color: #166534; font-weight: 700; }
.tctr-sc-note { color: #64748b; font-size: 10.5px; }
.tctr-inspect {
  color: var(--brand-navy, #1d4ed8); font-weight: 600; font-size: 11px;
  cursor: pointer; background: none; border: none; padding: 4px 0 0;
}

/* Accordions (Token Summary) */
.tctr-acc { border-top: 1px solid #e8eef7; }
.tctr-acc > summary {
  list-style: none; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: #16325c;
}
.tctr-acc > summary::-webkit-details-marker { display: none; }
.tctr-chev { transition: transform 0.15s; font-size: 10px; color: #64748b; }
.tctr-acc[open] .tctr-chev { transform: rotate(90deg); }
.tctr-count {
  margin-left: auto; font-size: 10.5px; font-weight: 600; color: #64748b;
  background: #eef2f9; border-radius: 999px; padding: 1px 7px;
}
.tctr-acc-body { padding: 2px 12px 12px; }

/* Token cards in the summary */
.tctr-tok { border: 1px solid; border-left-width: 4px; border-radius: 7px; padding: 8px 10px; margin-bottom: 8px; }
.tctr-tok--user { background: #fce7f3; border-color: #f472b6; }
.tctr-tok--agent { background: #e9d5ff; border-color: #c084fc; }
.tctr-tok--mcp { background: #d1fae5; border-color: #34d399; }
.tctr-tok-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tctr-tok-name { font-weight: 700; }
.tctr-tok--user .tctr-tok-name { color: #be185d; }
.tctr-tok--agent .tctr-tok-name { color: #7e22ce; }
.tctr-tok--mcp .tctr-tok-name { color: #047857; }
.tctr-tok-role { font-size: 10px; color: #475569; background: rgba(255, 255, 255, 0.6); padding: 1px 6px; border-radius: 4px; }
.tctr-tok-claims { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; color: #334155; line-height: 1.5; }
.tctr-tok-inspect {
  float: right; background: #fff; border: 1px solid #cbd5e1; border-radius: 5px;
  font-size: 10.5px; font-weight: 600; padding: 2px 8px; cursor: pointer; color: var(--brand-navy, #1d4ed8);
}
.tctr-tok-changes { margin-top: 6px; border-top: 1px dashed rgba(15, 23, 42, 0.15); padding-top: 5px; }
.tctr-tok-change { display: grid; grid-template-columns: 52px 1fr; gap: 6px; font-size: 10.5px; }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: PASS (4 tests). If the `open` toggle doesn't fire under jsdom via summary click, dispatch `fireEvent.click` on the `<summary>` — jsdom toggles native `<details>` on summary click; if not, set `promptStep.open = true` and `fireEvent(promptStep, new Event("toggle"))` instead and assert on content.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/TokenChainTraceRail.jsx demo_api_ui/src/components/TraceStepCard.jsx demo_api_ui/src/components/TraceTokenSummary.jsx demo_api_ui/src/components/TokenChainTraceRail.css demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx
git commit -m "feat(trace-rail): TokenChainTraceRail component family"
```

---

### Task 5: Ingestion wiring into existing funnels

**Files:**

- Modify: `demo_api_ui/src/context/TokenChainContext.js` (inside `setTokenEvents`, ~line 116)
- Modify: `demo_api_ui/src/hooks/useAgentState.js` (the `case 'CUSTOM':` branch, ~line 232)
- Modify: `demo_api_ui/src/components/AIAgent.js` (user-message send path)

**Interfaces:**

- Consumes: `tokenChainTraceStore` (Task 3).
- Produces: live data flowing into the store during real agent actions. No new exports.

- [ ] **Step 1: Wire `setTokenEvents` (single funnel for ALL BFF tokenEvents ingress)**

In `demo_api_ui/src/context/TokenChainContext.js`, add the import at the top:

```js
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
```

Inside the existing `setTokenEvents = useCallback((tool, newEvents) => {` body (~line 116), as the FIRST statement:

```js
    tokenChainTraceStore.ingestTokenEvents(Array.isArray(newEvents) ? newEvents : []);
```

(The store ignores empty arrays by design, matching the context's own clear semantics.)

- [ ] **Step 2: Wire AG-UI CUSTOM events in `useAgentState.js`**

Add import at top of `demo_api_ui/src/hooks/useAgentState.js`:

```js
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
```

Extend the existing `case 'CUSTOM':` (currently only `token_usage`, ~line 232):

```js
      case 'CUSTOM':
        if (event.name === 'token_usage' && event.value) {
          // ...existing token_usage handling stays unchanged...
        }
        if (event.name === 'llm_detail' && event.value) {
          tokenChainTraceStore.ingestLlmDetail(event.value);
        }
        break;
```

Also, in the `TEXT_MESSAGE_END` case (where a streamed assistant message completes), feed the reply — inside the existing `if (streamingMessageRef.current && event.messageId === ...)` block, after the ref is marked `streaming: false`:

```js
        tokenChainTraceStore.ingestLlmReply(streamingMessageRef.current.content);
```

- [ ] **Step 3: Wire `beginTrace(prompt)` in `AIAgent.js`**

Add import near the other service imports at the top of `demo_api_ui/src/components/AIAgent.js`:

```js
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
```

Find the main typed-message send handler: `grep -n "const handleSend\|function handleSend\|sendMessage = \|const send =" demo_api_ui/src/components/AIAgent.js` and locate where the user's message is appended to the chat (the first `addMessage("user"` / `setMessages` push of the typed input inside that handler, before the AG-UI/`sendAsNlInner` branch around line ~5470). Immediately after the user message is appended, add:

```js
    tokenChainTraceStore.beginTrace({ prompt: trimmedInput });
```

(using whatever local variable holds the trimmed message text at that site). Also find where action chips fire tool calls via `demoAgentService.callMcpTool` — in `demo_api_ui/src/services/demoAgentService.js`, `callMcpTool` already calls `agentFlowDiagram.startMcpToolCall(toolName)`; add next to it:

```js
    tokenChainTraceStore.beginTrace({ prompt: toolName });
```

with the import `import { tokenChainTraceStore } from "./tokenChainTrace/tokenChainTraceStore";` — BUT guard against clobbering a prompt-initiated trace that is already in flight:

In `tokenChainTraceStore.js`, `beginTrace` already resets. To support both entry points without double-reset, change nothing — the chip path has no chat prompt, so a fresh trace per tool call is correct; the typed path calls `beginTrace` once before the tool call begins, and `callMcpTool`'s `beginTrace` would clobber it. Guard in `demoAgentService.callMcpTool`:

```js
    if (!tokenChainTraceStore.getState().trace.startedAt ||
        Date.now() - tokenChainTraceStore.getState().trace.startedAt > 60_000) {
      tokenChainTraceStore.beginTrace({ prompt: toolName });
    }
```

Also ingest the authorize evaluation: in `demoAgentService.callMcpTool`, the `/api/mcp/tool` response body carries `mcpAuthorizeEvaluation` on success (`response.mcpAuthorizeEvaluation`). Where the response is unpacked (returns `{ result, tokenEvents }`, ~demoAgentService.js:617), add:

```js
    if (response && response.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(response.mcpAuthorizeEvaluation);
    }
```

- [ ] **Step 4: Run the store + component tests to confirm no regression**

Run: `npx vitest run src/services/tokenChainTrace src/components/__tests__/TokenChainTraceRail.test.jsx src/components/UserDashboardPing2026.test.js`
Expected: PASS. (TokenChainContext/useAgentState/AIAgent changes are additive one-liners; existing suites cover their render paths.)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/context/TokenChainContext.js demo_api_ui/src/hooks/useAgentState.js demo_api_ui/src/components/AIAgent.js demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js
git commit -m "feat(trace-rail): wire trace store into tokenEvents/AG-UI/send funnels"
```

---

### Task 6: `ExchangeModeToggle` — `hideTable` prop

**Files:**

- Modify: `demo_api_ui/src/components/ExchangeModeToggle.js` (163 lines; table at lines 84-144, security note at 145-161)
- Test: `demo_api_ui/src/components/__tests__/ExchangeModeToggle.hideTable.test.jsx` (create)

**Interfaces:**

- Produces: `ExchangeModeToggle({ hideTable = false })` — when `hideTable` is true, the explanatory token-role table (`.emt-tokens-table`) and the security note (`.emt-note`) are not rendered; the clickable header/badge and description line are unchanged. Default `false` preserves current behavior everywhere else.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/ExchangeModeToggle.hideTable.test.jsx`:

```jsx
import { render } from "@testing-library/react";
import ExchangeModeToggle from "../ExchangeModeToggle";

vi.mock("../../services/bffAxios", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { tokenExchangeMode: "chained" } })) },
}));

test("default renders the token-role table", async () => {
  const { container, findByText } = render(<ExchangeModeToggle />);
  await findByText(/Token Exchange Mode/i);
  expect(container.querySelector(".emt-tokens-table")).not.toBeNull();
});

test("hideTable suppresses the table and security note but keeps the header", async () => {
  const { container, findByText } = render(<ExchangeModeToggle hideTable />);
  await findByText(/Token Exchange Mode/i);
  expect(container.querySelector(".emt-tokens-table")).toBeNull();
  expect(container.querySelector(".emt-note")).toBeNull();
  expect(container.querySelector(".emt-header")).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/ExchangeModeToggle.hideTable.test.jsx`
Expected: second test FAILS (`.emt-tokens-table` still rendered). If the mock path differs (check the actual import in ExchangeModeToggle.js line ~1-10 — it imports `bffAxios` from `../services/bffAxios`), adjust the `vi.mock` path to `"../services/bffAxios"` relative to the component (from the test file in `__tests__/` that is `"../../services/bffAxios"`).

- [ ] **Step 3: Implement**

In `demo_api_ui/src/components/ExchangeModeToggle.js`:

Change the signature (line 20):

```js
export default function ExchangeModeToggle({ hideTable = false }) {
```

Wrap the table JSX (lines 84-144) and the note JSX (lines 145-161) in:

```jsx
{!hideTable && (
  /* existing .emt-tokens-table JSX exactly as-is */
)}
{!hideTable && (
  /* existing .emt-note JSX exactly as-is */
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/__tests__/ExchangeModeToggle.hideTable.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ExchangeModeToggle.js demo_api_ui/src/components/__tests__/ExchangeModeToggle.hideTable.test.jsx
git commit -m "feat(trace-rail): ExchangeModeToggle hideTable prop"
```

---

### Task 7: BFF — `exchangeRequest` detail on the `exchanged-token` event

**Files:**

- Modify: `demo_api_server/services/agentMcpTokenService.js` (completed `exchanged-token` event built at lines ~1582-1607)
- Test: `demo_api_server/tests/exchangedTokenEventExchangeRequest.test.js` (create)

**Interfaces:**

- Produces: the completed `exchanged-token` token event gains one extra field `exchangeRequest`: `{ grant_type, subject_token_type, actor_token_present: boolean, requested_token_type, scope, audience }` — token STRINGS are never included (placeholders only). The UI (Task 1 `buildTraceSteps`) already renders it when present.

- [ ] **Step 1: Locate the event and the request context**

In `demo_api_server/services/agentMcpTokenService.js`, the completed event is built around lines 1582-1607 with `buildTokenEvent('exchanged-token', …, extra)` where `extra` already includes `{ rfc, trigger, exchangeMethod, clientAuthMethod, actPresent, actDetails, audienceNarrowed, audMatches, audExpected, audActual, scopeNarrowed }`. The exchange inputs (`finalScopes`, `mcpResourceUri`, whether an actor token was used) are in scope in the surrounding function (`exchangeTokenRfc8693` callers, lines ~745-800). Read those lines first to bind exact local variable names.

- [ ] **Step 2: Write the failing test**

Create `demo_api_server/tests/exchangedTokenEventExchangeRequest.test.js`:

```js
// Regression: the completed exchanged-token event must carry an
// exchangeRequest teaching payload WITHOUT any raw token material.
const { buildTokenEvent } = require("../services/agentMcpTokenService");

describe("exchanged-token event exchangeRequest extra", () => {
  test("buildTokenEvent passes exchangeRequest through extra and never a token string", () => {
    const evt = buildTokenEvent(
      "exchanged-token", "Delegated Access Token", "active",
      { header: { alg: "RS256" }, claims: { sub: "u1", scope: "write" } },
      "explanation",
      { exchangeRequest: {
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
          actor_token_present: true,
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope: "write", audience: "https://mcp-gw.ping.demo" } }
    );
    expect(evt.exchangeRequest.grant_type).toContain("token-exchange");
    expect(evt.exchangeRequest.actor_token_present).toBe(true);
    expect(JSON.stringify(evt)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});
```

If `buildTokenEvent` is not exported from `agentMcpTokenService.js` (check `module.exports` at the bottom, ~line 2412), add it to the exports — it is a pure helper.

- [ ] **Step 3: Run test to verify it fails (or passes trivially)**

Run (from `demo_api_server/`): `npx jest tests/exchangedTokenEventExchangeRequest.test.js`
Expected: FAIL if `buildTokenEvent` is unexported; PASS once exported (extras already pass through — the real change is the call site).

- [ ] **Step 4: Implement the call-site change**

At the completed `exchanged-token` event build site (~1582-1607), extend `extra` with (bind to the actual local names found in Step 1 — `finalScopes` and `mcpResourceUri` per recon, and whether the exchange used an actor token per the configured method):

```js
        exchangeRequest: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          actor_token_present: Boolean(actorTokenUsed), // derive from the method branch
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: Array.isArray(finalScopes) ? finalScopes.join(' ') : String(finalScopes || ''),
          audience: mcpResourceUri || null,
        },
```

Never include `subject_token`/`actor_token` values. (`scrubRawJwts` on the route is a second line of defense, not a license.)

- [ ] **Step 5: Run the server test suite for the touched area**

Run: `npx jest tests/exchangedTokenEventExchangeRequest.test.js tests/mcpToolPipelineSseRequest.regression.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/tests/exchangedTokenEventExchangeRequest.test.js
git commit -m "feat(bff): exchangeRequest teaching payload on exchanged-token event"
```

---

### Task 8: Python agent — `llm_detail` CUSTOM AG-UI event

**Files:**

- Modify: `langchain_agent/src/agui/emitter.py` (add `on_llm_detail`, next to `on_usage` ~line 99)
- Modify: `langchain_agent/src/api/message_processor.py` (`on_chat_model_end` branch, ~lines 947-951)
- Test: `langchain_agent/tests/agui/test_llm_detail_event.py` (create)

**Interfaces:**

- Produces: AG-UI SSE frame `{ "type": "CUSTOM", "name": "llm_detail", "value": { "model": str, "request": {"messages": [{"role","content"}...]}, "toolCalls": [...], "usage": {"inputTokens","outputTokens"}|None } }`. The BFF (`routes/agentRun.js:410-413`) pipes agent SSE verbatim — no BFF change needed. The UI consumes it via Task 5's `useAgentState` CUSTOM case.
- Message content is TRUNCATED to 600 chars per message (teaching payload, not a transcript export).

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/agui/test_llm_detail_event.py`:

```python
import pytest

from src.agui.emitter import AGUIEventEmitter


@pytest.mark.asyncio
async def test_on_llm_detail_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=sink)
    await emitter.on_llm_detail(
        model="qwen2.5-14b-instruct",
        messages=[{"role": "system", "content": "You are a banking assistant." * 100}],
        tool_calls=[{"name": "transfer_funds", "args": {"amount": 250}}],
        usage={"inputTokens": 1842, "outputTokens": 61},
    )

    assert len(events) == 1
    evt = events[0]
    assert evt["type"] == "CUSTOM"
    assert evt["name"] == "llm_detail"
    assert evt["value"]["model"] == "qwen2.5-14b-instruct"
    assert evt["value"]["toolCalls"][0]["name"] == "transfer_funds"
    assert evt["value"]["usage"]["outputTokens"] == 61
    # content truncated to 600 chars
    assert len(evt["value"]["request"]["messages"][0]["content"]) <= 600


@pytest.mark.asyncio
async def test_on_llm_detail_swallows_sink_errors():
    async def bad_sink(evt):
        raise RuntimeError("boom")

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=bad_sink)
    await emitter.on_llm_detail(model="m", messages=[], tool_calls=[], usage=None)
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `langchain_agent/`): `python -m pytest tests/agui/test_llm_detail_event.py -v`
Expected: FAIL — `AGUIEventEmitter has no attribute 'on_llm_detail'`.

- [ ] **Step 3: Implement `on_llm_detail` in `emitter.py`**

Add next to `on_usage` (mirror its raw-`_sink` + swallow-errors style exactly):

```python
    async def on_llm_detail(
        self,
        model: str,
        messages: list,
        tool_calls: list,
        usage: Optional[Dict[str, int]] = None,
    ) -> None:
        """Teaching payload for the Token Chain trace rail: what was actually
        sent to the LLM and what it decided. Content is truncated — this is a
        classroom exhibit, not a transcript export."""
        def _trunc(m):
            content = str(m.get("content", ""))[:600]
            return {"role": m.get("role", "?"), "content": content}
        try:
            await self._sink({
                "type": "CUSTOM",
                "name": "llm_detail",
                "value": {
                    "model": model,
                    "request": {"messages": [_trunc(m) for m in (messages or [])]},
                    "toolCalls": tool_calls or [],
                    "usage": usage,
                },
            })
        except Exception:
            logger.exception("AG-UI sink error")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/agui/test_llm_detail_event.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Emit from the astream loop**

In `langchain_agent/src/api/message_processor.py`, in the `on_chat_model_end` branch (~lines 947-951, where `output.usage_metadata` is already read), add after the existing usage emission:

```python
                    try:
                        _msgs = event.get("data", {}).get("input", {}).get("messages") or []
                        _flat = []
                        for _group in _msgs:
                            for _m in (_group if isinstance(_group, list) else [_group]):
                                _flat.append({
                                    "role": getattr(_m, "type", None) or getattr(_m, "role", "?"),
                                    "content": str(getattr(_m, "content", ""))[:600],
                                })
                        _out = event.get("data", {}).get("output")
                        _tool_calls = list(getattr(_out, "tool_calls", None) or [])
                        await emitter.on_llm_detail(
                            model=event.get("metadata", {}).get("ls_model_name", "unknown"),
                            messages=_flat,
                            tool_calls=_tool_calls,
                            usage={
                                "inputTokens": total_input_tokens,
                                "outputTokens": total_output_tokens,
                            },
                        )
                    except Exception:
                        logger.exception("llm_detail emission failed (non-fatal)")
```

Bind names to the actual local variables in that branch (the recon confirmed `output.usage_metadata` → `total_input_tokens/total_output_tokens` accumulation and `event["metadata"]` availability; adjust the emitter variable name to whatever the loop uses — check how `on_usage` is invoked in the same file).

- [ ] **Step 6: Run the agent's existing agui tests**

Run: `python -m pytest tests/agui/ tests/test_agent_message_processing.py -v`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add langchain_agent/src/agui/emitter.py langchain_agent/src/api/message_processor.py langchain_agent/tests/agui/test_llm_detail_event.py
git commit -m "feat(agent): llm_detail CUSTOM AG-UI event for the trace rail"
```

---

### Task 9: Customer Dashboard 2026 — token rail to the right column

**Files:**

- Modify: `demo_api_ui/src/components/UserDashboardPing2026.js` (middle layout JSX ~3208-3290; float layout JSX ~3324-3350)
- Modify: `demo_api_ui/src/components/UserDashboard.css` (append 2026-scoped overrides; do NOT edit the shared rules at lines 127-130/149-152/3693-3695 in place — the legacy `UserDashboard.js` uses the same classes and must keep its left rail)

**Interfaces:**

- Consumes: existing classes `ud-token-rail`, `ud-body--dashboard-split3`, `ud-body--float-mode`; the 2026 root wrapper class `user-dashboard--2026` (present only on `UserDashboardPing2026`'s root — the scoping key).
- Produces: on the 2026 skin only, DOM/source order Agent → (Banking) → Token rail, and grid tracks reordered so the rail is the LAST (rightmost) column in the `middle` and `float` layouts. The `bottom` layout (`rd2-right-rail`) is already right — untouched.

- [ ] **Step 1: Move the JSX — middle layout**

In `UserDashboardPing2026.js` middle layout (container at ~3208), the current child order is: `<aside className="ud-token-rail">…</aside>` (3212-3217), `<section className="ud-agent-column">…`, `<main className="ud-center ud-banking-column">…` (conditional). CUT the entire `<aside className="ud-token-rail" aria-label="Token chain">…</aside>` block and PASTE it after the closing tag of the LAST column in that container (after the conditional `</main>` / after `</section>` when banking is hidden — i.e., make it the final child before the container's closing `</div>`).

- [ ] **Step 2: Move the JSX — float layout**

Same operation in the float layout (~3324-3350): move the `<aside className="ud-token-rail">…</aside>` block after `</main>` (the `ud-center` main), making it the last grid child.

- [ ] **Step 3: Append 2026-scoped CSS overrides**

At the end of `demo_api_ui/src/components/UserDashboard.css` add:

```css
/* ── 2026 skin: token rail on the RIGHT (Side Menu | Agent | Token Chain) ──
 * Scoped to .user-dashboard--2026 so the legacy UserDashboard keeps its
 * left rail. JSX source order was flipped to match (rail is last child);
 * these rules put the wide/narrow tracks in the matching order. */
.user-dashboard--2026 .ud-body.ud-body--dashboard-split3 {
  grid-template-columns: 1fr minmax(360px, 420px) minmax(240px, 260px);
}
.user-dashboard--2026 .ud-body.ud-body--dashboard-split3.ud-body--dashboard-split3--no-banking {
  grid-template-columns: 2fr minmax(280px, 0.9fr);
}
.user-dashboard--2026 .ud-body.ud-body--2026.ud-body--float-mode {
  grid-template-columns: minmax(0, 1fr) 380px;
}
.user-dashboard--2026 .ud-token-rail {
  border-right: none;
  border-left: 1px solid var(--brand-medium-gray);
}
```

- [ ] **Step 4: Check the responsive collapse variants**

Read `UserDashboard.css` lines 149-232 and 366-390 (the `ud-middle-collapsed` and `@media` overrides that also set `grid-template-columns` for `ud-body--dashboard-split3`). For each rule that still assumes the rail is the FIRST track, add a `.user-dashboard--2026`-scoped override with the tracks reversed, following the same pattern as Step 3. In single-column media queries (grid becomes one column), no override is needed — source order now places the rail after the content, which is the correct mobile order (content first).

- [ ] **Step 5: Run the 2026 dashboard tests**

Run: `npx vitest run src/components/UserDashboardPing2026.test.js src/components/__tests__/UserDashboardPing2026.test.js`
Expected: PASS. (These tests assert rendering, not column geometry; the sha canary hashes `UserDashboard.js`, which this task does not touch.)

- [ ] **Step 6: Visual check**

Start the dev server (`REACT_APP_API_HOST=api.ping.demo REACT_APP_API_HTTPS=true npx vite --port 4400 --strictPort` from `demo_api_ui/`), open `http://localhost:4400/dashboard`, and verify in all three 2026 layout modes (layout switcher in the top nav): the token rail is the rightmost column; no horizontal scrollbar; single-column collapse puts the rail below the content. Compare against `docs/superpowers/specs/2026-07-03-dashboard-2026-layout-mock.html`.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/UserDashboardPing2026.js demo_api_ui/src/components/UserDashboard.css
git commit -m "feat(2026-dashboard): move token rail to the right column"
```

---

### Task 10: Swap all 8 embed points to `TokenChainTraceRail`

**Files:**

- Modify: `demo_api_ui/src/components/UserDashboard.js` (3 sites — currently `<UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} embedded />` from commit `0e3a9bf89`)
- Modify: `demo_api_ui/src/components/UserDashboardPing2026.js` (3 sites, same)
- Modify: `demo_api_ui/src/components/Dashboard.js` (1 site, same)
- Modify: `demo_api_ui/src/components/TokenChainModal.js` (tab body swap)
- Modify: `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx` + `.css` (revert `embedded`)
- Modify test mocks: `demo_api_ui/src/components/UserDashboardPing2026.test.js`, `demo_api_ui/src/components/__tests__/UserDashboardPing2026.test.js`, `demo_api_ui/src/components/__tests__/buttonRouting.test.js`, `demo_api_ui/src/theme/__tests__/refinedSurface.test.js`

**Interfaces:**

- Consumes: `TokenChainTraceRail` (Task 4), `ExchangeModeToggle hideTable` (Task 6).
- Produces: every embed renders `<ExchangeModeToggle hideTable />` + `<TokenChainTraceRail />`.

- [ ] **Step 1: Swap the 7 dashboard sites**

In each of `UserDashboard.js` (3×), `UserDashboardPing2026.js` (3×), `Dashboard.js` (1×), replace:

```jsx
<ExchangeModeToggle />
<UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} embedded />
```

with:

```jsx
<ExchangeModeToggle hideTable />
<TokenChainTraceRail />
```

and swap the import in each file: remove `import UnifiedTokenFlowInspector from "./UnifiedTokenFlowInspector";`, add `import TokenChainTraceRail from "./TokenChainTraceRail";`.

- [ ] **Step 2: Swap the TokenChainModal tab body**

In `demo_api_ui/src/components/TokenChainModal.js`: replace `import TokenChainDisplay from './TokenChainDisplay';` with `import TokenChainTraceRail from './TokenChainTraceRail';` and replace `<TokenChainDisplay hideHeader />` (line ~80) with `<TokenChainTraceRail />`. Keep the `ActivityLogPanel` tab and the `DraggableModal` shell untouched.

- [ ] **Step 3: Revert the `embedded` prop on UnifiedTokenFlowInspector**

In `UnifiedTokenFlowInspector.jsx`: restore the signature to `({ floatingByDefault = false, showToggle = true, showClose })` and the container className to `` `utfi-container ${isFloating ? 'utfi-floating' : 'utfi-fixed'}` ``. In `UnifiedTokenFlowInspector.css`: delete the entire `/* Embedded mode … */` block (all `.utfi-container.utfi-embedded …` rules added in commit `0e3a9bf89`).

- [ ] **Step 4: Update test mocks**

- `src/components/UserDashboardPing2026.test.js:103`: change `vi.mock("./UnifiedTokenFlowInspector", …)` to `vi.mock("./TokenChainTraceRail", () => ({ default: () => null }));`
- `src/components/__tests__/UserDashboardPing2026.test.js` (~line 156): change `vi.mock("../UnifiedTokenFlowInspector", …)` to `vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));`
- `src/components/__tests__/buttonRouting.test.js` (~line 155): same rename (`../UnifiedTokenFlowInspector` → `../TokenChainTraceRail`).
- `src/theme/__tests__/refinedSurface.test.js` (~line 97): same rename (`../../components/UnifiedTokenFlowInspector` → `../../components/TokenChainTraceRail`).
- Keep the existing `TokenChainDisplay` mocks — other components in those trees still import it.

- [ ] **Step 5: Re-baseline the UserDashboard.js sha256 canary**

Run: `npx vitest run src/components/__tests__/UserDashboardPing2026.test.js`
Expected: canary test 8 FAILS showing the new hash. Copy the "Received" hash into `FROZEN_SHA256` (line ~315) and update its comment to say: re-baselined for the TokenChainTraceRail embed swap. Re-run — expected: PASS.

- [ ] **Step 6: Run all affected suites**

Run: `npx vitest run src/components/UserDashboardPing2026.test.js src/components/__tests__/UserDashboardPing2026.test.js src/components/__tests__/buttonRouting.test.js src/theme/__tests__/refinedSurface.test.js src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: PASS.

- [ ] **Step 7: Production build**

Run: `npx vite build`
Expected: builds cleanly (no unresolved imports — confirms the UnifiedTokenFlowInspector revert left `/agent-flow-inspector` and DevToolsDashboard intact).

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/UserDashboard.js demo_api_ui/src/components/UserDashboardPing2026.js demo_api_ui/src/components/Dashboard.js demo_api_ui/src/components/TokenChainModal.js demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx demo_api_ui/src/components/UnifiedTokenFlowInspector.css demo_api_ui/src/components/UserDashboardPing2026.test.js demo_api_ui/src/components/__tests__/UserDashboardPing2026.test.js demo_api_ui/src/components/__tests__/buttonRouting.test.js demo_api_ui/src/theme/__tests__/refinedSurface.test.js
git commit -m "feat(trace-rail): swap all 8 token chain embeds to TokenChainTraceRail"
```

---

### Task 11: Full verification — suites + live drive-through

**Files:** none (verification only).

- [ ] **Step 1: Full UI suite**

Run (from `demo_api_ui/`): `npx vitest run`
Expected: same pass/fail profile as the base commit plus the new tests passing. Known pre-existing failures on this branch's base (verify unchanged, do NOT fix here): `useDraggablePanel.test.js`, `uiRegression.test.js` (monospace check), `useCustomChips.test.js`, `AgentUiModeContext.test.js` — 9 failures reproduced on clean base 2026-07-02.

- [ ] **Step 2: BFF suite**

Run (from `demo_api_server/`): `npx jest --forceExit`
Expected: same profile as base plus `exchangedTokenEventExchangeRequest.test.js` passing.

- [ ] **Step 3: Python agent suite**

Run (from `langchain_agent/`): `python -m pytest tests/agui/ -v`
Expected: PASS including `test_llm_detail_event.py`.

- [ ] **Step 4: Live drive-through (browser, against the running stack)**

1. From `demo_api_ui/`: `REACT_APP_API_HOST=api.ping.demo REACT_APP_API_HTTPS=true npx vite --port 4400 --strictPort`
2. Open `http://localhost:4400/dashboard`, sign in as the demo customer, confirm: 2026 layout order Side Menu | Agent | Token Chain; rail loads collapsed (header + chain line + step titles only).
3. Drive a transfer through the agent chat ("transfer $250 to savings"). Verify steps light up in order; expand: **llm** (model + messages + tool call + token counts), **exchange** (exchangeRequest + scope diff + act), **authorize** (engine, URL, parameters, raw decision, decisionId), **gateway** (introspection/authorize checks), **mcp/api** (JSON-RPC + result), **reply**.
4. Open Token Summary — every token with claims + change rows (scope narrowed, aud rebound, act added).
5. Drive a step-up scenario (withdrawal ≥ $250) — verify the conditional step-up step appears.
6. Verify no raw JWTs anywhere: search the rendered DOM for `eyJ` (`document.body.innerHTML.includes('eyJ')` in the console — placeholder prefixes like `eyJ…` from server text are acceptable; full 3-segment tokens are not: check with `/eyJ[A-Za-z0-9_-]{20,}\./`).
7. Check the admin portal (`/` as admin) and classic customer dashboard — rail unchanged position, new component renders.
8. Open the agent chat, toggle "Token Chain" — the floating `TokenChainModal` shows the same rail.
9. Verify `/monitoring/token-chain` and `/agent-flow-inspector` still render their original components.

- [ ] **Step 5: Update CHANGELOG/FEATURES if the repo convention requires it, final commit, then present the branch for PR**

```bash
git log --oneline origin/main..HEAD
```

Expected: the task commits above, ready for a PR titled "feat: Token Chain Trace Rail — full-pipeline trace on customer/admin portals".
