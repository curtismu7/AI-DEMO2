# OAuth Teaching Agent — P2 (EXPLAIN) + P3 (SHOW) Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** P2 (EXPLAIN) and P3 (SHOW) only. **P4 (DEMONSTRATE) is explicitly out of scope** and will get its own design (it runs real token-exchange / scope-denial / HITL operations and carries materially higher risk).

Related: `docs/OAUTH_TEACHING_AGENT_PLAN.md` (original plan), memory `project-oauth-teaching-agent-deferred`.

---

## Background

P1 shipped the `oauth-teaching` vertical (persona overlay) at
`demo_api_server/config/verticals/oauth-teaching/` — `manifest.json` (identity "OAuth Academy",
indigo theme, teaching terminology, 10 LLM chips) + `index.js` (teaching heuristics, teacher
`getSystemPrompt()`, and four P1 **stub** tools that return a hardcoded "scaffolded in P1" string).
The Helix directive for `oauth-teaching` is already wired in `docs/HELIX_AGENT_DIRECTIVES.json`
(emits `action:"explain"|"demonstrate"`).

P2 adds the **EXPLAIN** verb; P3 adds the **SHOW** verb. Both are read-only — they explain
concepts, open the right education panel, render flow diagrams, and decode the user's *real*
session token. Neither performs a state-changing operation.

### Correction to the original plan doc

The plan doc (`docs/OAUTH_TEACHING_AGENT_PLAN.md`) names stale wiring targets. Verified against
current code:

- The live chat surface is **`demo_api_ui/src/components/AIAgent.js`**, not `BankingAgent.js`.
- `useAgentRun.js` (an experimental AG-UI hook) is **not** used by the main chat.
- Therefore the planned **new typed `teaching_directive` SSE event is NOT built.** The main chat
  uses request/response (`sendAgentMessage`), and a working agent→panel mechanism already exists
  (`kind:'education'` → `edu.open(EDU.*)` at `AIAgent.js:~6346`). We reuse that mechanism.

---

## Execution model — local-tool bypass (decided 2026-06-19)

**Critical contract** (verified against `demoAgentLangGraphService.dispatchVerticalIntent`,
~line 695): for non-banking verticals, a heuristic-matched tool call **always** (1) runs a P1AZ
**authz pre-flight** (`agentPreflightService.evaluate`, ~732) and (2) executes via
**`executePluginToolViaMcp`** (~875) — a real RFC 8693 exchange → gateway → MCP server → backend.
The plugin's own `executeTool` is reached **only** through MCP-registered tools.

Teaching tools (`explain_concept`, `open_education_panel`, `show_flow_diagram`) are **pure local
computations** (canned explanation text + an education-panel directive) and must NOT trigger an
authz decision or a token exchange. `inspect_token` is the one exception — it deliberately performs
a real exchange (see P3).

**Resolution — a local-tool bypass in the shared dispatch.** `dispatchVerticalIntent` gains an
early branch, *before* the authz pre-flight and MCP path: if the active plugin declares the action
a **local tool**, call `plugin.executeTool(action, params, ctx)` directly and build the response
from its `{ result, render }` (plus optional `result.education`), skipping pre-flight and MCP
entirely.

- The plugin signals local tools by exporting `isLocalTool(name): boolean` (returns true for the
  teaching tool names). `dispatchVerticalIntent` checks `plugin.isLocalTool?.(action)`.
- The local branch is generic (any future vertical can opt a tool in) and tightly scoped — it only
  fires for tools a plugin explicitly marks local. This is a REGRESSION-tracked edit to shared
  dispatch; the change is additive (an early return for opted-in tools; all existing tools are
  unaffected because no current plugin implements `isLocalTool`).
- Response shape built by the local branch (mirrors the MCP branch at ~910): `{ reply, success,
  toolsCalled:[action], tokensUsed:0, requiresConsent:false, agentConfigured:true, tokenEvents,
  verticalResult:{ action, render, data }, ...(result.education ? { education:result.education } : {}) }`.

## Architecture — the directive bridge (UI side, shared by P2 + P3)

- **Server:** a teaching tool's `executeTool` returns `{ result, render }` where `result` may carry
  `education: { panel, tab }` and (for `inspect_token`) the decoded token data. The local-bypass
  branch passes `result.education` through to the response as a top-level `education` field, and
  wraps `result`/`render` into `verticalResult` (same shape the MCP branch produces).
- **Transport:** rides the existing `/api/agent/invoke` request/response, which forwards arbitrary
  response fields verbatim (`agentInvokeRoute.js:~346 return res.json(agentResponse)`). **No new
  SSE event.**
- **UI:** `AIAgent.js`'s `kind:'vertical'` handler gains one small commented line right after the
  `addMessage` at **~6628**: `if (response.education?.panel) edu?.open(response.education.panel, response.education.tab || null);`
  (`edu` is already in scope at ~1960). This mirrors the existing `kind:'education'` call at ~6346.
  `edu.open()` fires only for a resolvable `EDU.*` id; an unknown id is ignored (no crash).

Panel IDs reuse the existing registry `demo_api_ui/src/components/education/educationIds.js`.
The topic→panel mapping reuses the concept set in `nlIntentParser.parseEducation` — no parallel table.

**Heuristic → tool name:** for the generic vertical path, the heuristic's `action` string **is** the
tool name (verified: `dispatchVerticalIntent` calls the tool named `action` directly). So the plugin
heuristics emit `action:'explain_concept'` / `'show_flow_diagram'` / `'inspect_token'` and the tools
are declared with those exact names. Tool schemas use **`inputSchema`** (not `parameters`) per
`verticalDispatch.toToolSchema`.

**File-size note:** `AIAgent.js` is ~9700 lines. This design does **not** refactor it (out of
scope); the new logic is one small commented block in the existing vertical handler.

---

## P2 — EXPLAIN

Two new read-only tools in `demo_api_server/config/verticals/oauth-teaching/index.js`:

1. **`explain_concept(topic)`** — returns a teacher-voice explanation with the relevant RFC
   citation, plus `education:{ panel, tab }` to open the matching panel. The
   `topic → { explanation, panel, tab }` table reuses the `parseEducation` concept set, e.g.:
   - token exchange → `TOKEN_EXCHANGE` / `RFC_8693`
   - PKCE / auth code → `LOGIN_FLOW` (tab `pkce`)
   - scopes / least privilege → `SENSITIVE_DATA`
   - may_act / act delegation → `MAY_ACT`
   - introspection → `INTROSPECTION`
   Unknown topic → a graceful "I can explain: …" list, no panel opened (never throws).

2. **`open_education_panel(edu_id, tab?)`** — thin tool that returns `education:{ panel:edu_id, tab }`
   for direct "open the X panel" requests.

**Routing:** the existing Helix directive emits `action:"explain"`, and the plugin's
`getHeuristics()` already has an explain regex; both map to `explain_concept`. **No
`nlIntentParser` THEME_VOCAB change** — the plugin owns its heuristics.

**Exit criteria:** in the `oauth-teaching` vertical, "explain token exchange" produces a
teacher-voice reply with an RFC cite **and** opens the `TOKEN_EXCHANGE` panel.

---

## P3 — SHOW

Two new read-only tools in the same plugin:

1. **`show_flow_diagram(flow)`** — returns a short text intro + `education:{ panel }` opening a
   diagram panel (`FLOW_DIAGRAMS`, `LOGIN_FLOW`, `TOKEN_FLOW`, or `TOKEN_CHAIN`). Pure reuse of
   the P2 directive bridge.

2. **`inspect_token()`** — shows **T1 (session) and T2 (exchanged) side by side** so the learner
   sees exactly what the RFC 8693 exchange changed (sub preserved, aud narrowed, `act` added). It is
   a local tool but deliberately performs a **real** user→MCP exchange for teaching:
   - Decode T1 from `ctx.userToken` via `tokenDisplayService.decodeToken` → `{ header, payload }`.
   - Mint/decode T2 by reusing the existing exchange path (`agentMcpTokenService` /
     `/api/pingone-test/exchange-user-to-mcp` returns the decoded exchanged token). Any exchange
     `tokenEvents` produced are merged into the response so the live Token Chain updates too.
   - Return `result = { t1: {header,payload,tokenType}, t2: {header,payload,tokenType} }` with
     `render:'token-pair'`. Both are classified via `tokenDisplayService.classifyTokenType`.
   - **No raw token string** is ever returned (only `{header, payload, tokenType}`, matching the
     `/api/token-display/raw-decode` shape that `TokenCard` expects), consistent with the
     token-chain leakage tests.
   - If `ctx.userToken` is absent → text reply prompting sign-in, no `verticalResult`. If the
     exchange fails → render T1 alone with a note that the exchange couldn't be performed.

**UI render wiring** (`demo_api_ui/src/components/VerticalResult.jsx`): the component currently
whitelists only `type ∈ {card, fieldList, table}`. Add:
- `type:'token'` → `<TokenCard decoded={data} />` (single token),
- `type:'token-pair'` → two `<TokenCard>`s (`data.t1`, `data.t2`) side by side with sub-titles
  "Session token (T1)" / "Exchanged token (T2)".
Import `TokenCard` (`demo_api_ui/src/components/TokenCard.jsx`, default export; `decoded` prop =
`{header, payload, tokenType}`). The manifest `render` map gets
`inspect_token: { type:'token-pair', title:'Your tokens — before & after exchange' }` (and
`show_flow_diagram`/`explain_concept` use `render:'text'`, so they fall through to the text path and
rely on the `education` directive + reply).

**Routing:** add `getHeuristics()` regexes for "show me the X flow" (→ `show_flow_diagram`) and
"inspect / decode my token" (→ `inspect_token`). Still no `nlIntentParser` change.

**Exit criteria:** "show me the auth code flow" opens `LOGIN_FLOW`; "inspect my token" renders two
TokenCards (T1 + T2) with real decoded claims, no raw token string, and updates the Token Chain.

### Tool registry change

P1's stub tools `explain` / `demonstrate` are replaced/augmented so that `explain_concept`,
`open_education_panel`, `show_flow_diagram`, `inspect_token` become **real local tools** (the plugin
exports `isLocalTool(name)` returning true for these four). The `demonstrate` / `api_key_demo` /
`dual_token_demo` stubs **remain stubs** (P4 territory).

---

## Error handling

All P2/P3 paths are read-only, so failure modes are benign:

- `explain_concept` / `show_flow_diagram` unknown topic → friendly "here's what I can
  explain/show" list, no panel, never throws.
- `inspect_token` with no `ctx.userToken` (not signed in) → text reply prompting sign-in, no
  `verticalResult`. Decode failure → caught, returns "couldn't decode the current token".
- UI bridge → `edu.open()` only fires for a resolvable `EDU.*` id; unknown id ignored.
- No raw token ever leaves the server (sanitization via existing token services / `TokenCard`).

---

## Testing

- **Unit (`demo_api_server/src/__tests__`)**: `oauth-teaching/index.js` `executeTool` — each tool
  returns the expected `{ reply, education? }` / `{ verticalResult }` shape; unknown-topic and
  no-token paths handled; `getHeuristics()` matches the intended phrases.
- **Real (`demo_api_server/tests/real/shared`)**: a suite that switches to the `oauth-teaching`
  vertical and asserts (a) "explain token exchange" → `education.panel === 'TOKEN_EXCHANGE'`,
  (b) "inspect my token" → a `verticalResult` with decoded claims and **no** raw token; restores
  the vertical in `afterAll` (avoids vertical-switch bleed).
- **UI**: minimal — the bridge is ~10 lines; covered by manual verification plus the real suite
  asserting the response field. No new heavy UI test.

---

## Out of scope (explicit)

- **P4 DEMONSTRATE** (`demonstrate_token_exchange`, `demonstrate_scope_denial`,
  `demonstrate_hitl`) — real operations; separate design.
- Any `AIAgent.js` refactor.
- New SSE / streaming / AG-UI adoption.
- `nlIntentParser` THEME_VOCAB changes.
- Curriculum / ordered skill path (plan's P5) and `.claude/skills/oauth-teaching-agent/SKILL.md`.

---

## Files touched (anticipated)

- `demo_api_server/config/verticals/oauth-teaching/index.js` — real local tools, `isLocalTool`,
  heuristics, topic→panel map (reusing the `parseEducation` concept set)
- `demo_api_server/config/verticals/oauth-teaching/manifest.json` — `render` map entry for
  `inspect_token` (`type:'token-pair'`)
- `demo_api_server/services/demoAgentLangGraphService.js` — local-tool bypass branch in
  `dispatchVerticalIntent` (before authz pre-flight + MCP), additive; REGRESSION-tracked
- `demo_api_ui/src/components/VerticalResult.jsx` — add `token` / `token-pair` render branches +
  import `TokenCard`
- `demo_api_ui/src/components/AIAgent.js` — one-line `education` directive bridge in the
  `kind:'vertical'` handler (~6628)
- `demo_api_server/src/__tests__/oauth-teaching.*.test.js` — unit tests for the plugin tools +
  `isLocalTool` + the dispatch local-bypass branch
- `demo_api_server/tests/real/shared/oauth-teaching-*.test.js` — real-call suite

Reuses (no change): `educationIds.js`, `EducationUIContext.js`, `TokenCard.jsx`,
`tokenDisplayService.js` (`decodeToken` / `classifyTokenType`), `agentMcpTokenService` /
`/api/pingone-test/exchange-user-to-mcp` (for `inspect_token`'s T2), `nlIntentParser.parseEducation`
mapping set, `docs/HELIX_AGENT_DIRECTIVES.json` (already wired).
