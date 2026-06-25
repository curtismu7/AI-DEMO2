# OAuth Teaching Agent — P4 (DEMONSTRATE) Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** P4 (DEMONSTRATE) only. Builds on the shipped P1 vertical and the P2 (EXPLAIN) / P3 (SHOW) design.

Related:
- `docs/superpowers/specs/2026-06-19-oauth-teaching-p2-p3-design.md` (the pattern this mirrors)
- `docs/OAUTH_TEACHING_AGENT_PLAN.md` (original P1–P5 overview)
- memory `project-oauth-teaching-agent-deferred`

---

## Background

P1 shipped the `oauth-teaching` vertical (persona overlay). P2/P3 added the **read-only** verbs:
EXPLAIN (`explain_concept`, `open_education_panel`), SHOW (`show_flow_diagram`, `inspect_token`).
These are local tools that explain concepts, open education panels, and decode the user's *real*
session/exchanged tokens — none performs a state-changing operation.

P4 adds the **DEMONSTRATE** verb: three tools that run the **genuine** banking pipeline so a learner
sees real RFC 8693 token exchange, real least-privilege enforcement, and real human-in-the-loop
consent — not canned text. P4 replaces the P1 `demonstrate` stub with these three `demonstrate_*`
tools. The `api_key_demo` / `dual_token_demo` P1 stubs are **out of scope** for P4 and remain stubs
(see Out of scope).

P4 carries materially higher risk than P2/P3 because one tool moves (resettable, demo) money. The
safety section below bounds that risk.

---

## Architecture

Three new tools on `demo_api_server/config/verticals/oauth-teaching/index.js`, each declared a
**local tool** (`isLocalTool(name) === true`):

- `demonstrate_token_exchange`
- `demonstrate_scope_denial`
- `demonstrate_hitl`

**Outer = local teaching orchestrator; inner = the real pipeline.** Marking each tool local means the
*outer* action skips the P1AZ authz pre-flight and the MCP dispatch in `dispatchVerticalIntent` (we do
not authorize the act of "demonstrate"). Instead, each tool's `executeTool` body **internally drives the
real banking pipeline** by calling the existing `executeBffTool` — which performs the genuine
RFC 8693 exchange → gateway → authorize → MCP server → backend. The teaching value is real; only the
outer orchestration is local.

Each demonstrate tool calls an **existing banking MCP tool** internally. No new MCP tools are added.

| Tool | Inner banking call | Teaches |
|------|--------------------|---------|
| `demonstrate_token_exchange` | `get_my_accounts` (read) | T1 → RFC 8693 exchange → T2 (aud narrowed, scope, act) → backend hop sequence |
| `demonstrate_scope_denial` | a banking tool whose required scope the exchanged token lacks | Least-privilege enforcement at the resource (real denial) |
| `demonstrate_hitl` | `create_transfer` (small fixed amount) | Real 428 → consent modal → approve → real transfer → receipt-aware PERMIT |

### Verified contracts (investigated 2026-06-19)

1. **`executeBffTool` returns a JSON *string*, not an object**
   (`demo_api_server/services/bffMcpToolExecutor.js:45`):
   `async function executeBffTool({ name, args, userId, userToken, req = null, tokenEvents = [], sessionId = '' })`.
   On success it returns `JSON.stringify(result)`; failures are encoded **in-band** as JSON strings:
   `{ error: 'hitl_required' | 'step_up_required' | 'mcp_authorization_denied' | 'mcp_error' | 'mcp_blocked', ... }`
   (HITL blocks carry the 428 body). Each demonstrate tool therefore `JSON.parse`s the result and
   branches on `parsed.error`. The denial and the 428 we want to *show* arrive as parsed objects, not
   thrown exceptions — they are the demo payload, not a failure of the tool.

2. **The local-bypass `ctx` already carries everything `executeBffTool` needs.**
   `dispatchVerticalIntent` (`demo_api_server/services/demoAgentLangGraphService.js:733-764`) invokes
   `plugin.executeTool(action, params, { userId, userToken, req, tokenEvents, sessionId, isAdmin })`.
   That maps 1:1 onto `executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId })`.
   No plumbing gap; `tokenEvents` is the **same array**, so real exchange hops pushed by
   `executeBffTool` (`bffMcpToolExecutor.js:64-113`) flow back to the response and the live Token Chain.

3. **Real banking accounts exist in the oauth-teaching vertical.** There is no `oauth-teaching` seed
   profile, so `seedAccountsForUser` falls back to the **banking** profile
   (`demo_api_server/data/store.js:542` — `SEED_PROFILES[vertical] || SEED_PROFILES.banking`). A signed-in
   user already has two accounts (checking/savings) with balances.

4. **HITL on the MCP pipeline is amount-based, NOT "transfers always consent."** The
   "all transfers require consent" rule (`transactionConsentChallenge.js`) belongs to the BFF banking
   path, **not** the MCP authz gate `demonstrate_hitl` uses. On the MCP path, type-based rules do not
   apply (`demo_api_server/services/simulatedAuthorizeService.js:354-363`); the decision is purely the
   transfer amount against the simulated thresholds (defaults: confirm `$250`, step-up `$500`):
   - `< $250` → PERMIT (transfer executes, **no** HITL),
   - `$250 ≤ amount < $500` → **HITL plain consent** (the `AgentConsentModal` band we want),
   - `≥ $500` → STEP_UP (MFA), not the plain consent modal.
   Therefore `demonstrate_hitl` uses a **fixed `$300`** transfer (in the plain-consent band) to reliably
   produce the consent challenge. (This corrects an earlier draft that assumed "$1 / always 428.")

5. **The pipeline 428 body uses different field names than the UI expects.** `executeBffTool` returns a
   JSON *string*; on a HITL block (`demo_api_server/services/mcpToolPipeline.js:413-429`) the body has
   `error: 'mcp_hitl_required'` and `challengeId` (+ `taskId` alias). The UI vertical-consent handler
   (`demo_api_ui/src/components/AIAgent.js`, the `kind:'vertical'` path) reads `error: 'hitl_required'`
   and `response.hitlChallengeId`. So `demonstrate_hitl` must **translate** `mcp_hitl_required → hitl_required`
   and `challengeId → hitlChallengeId`, and the local-bypass branch must emit the proven vertical-HITL
   envelope (`demoAgentLangGraphService.js:927-939`).

### Local-bypass response shape (reused from P2/P3)

The local branch wraps each tool's `{ result, render }` into the response the same way the P2/P3 tools
do (mirrors `dispatchVerticalIntent` ~lines 733-764):
`{ reply, success, toolsCalled:[action], tokensUsed:0, agentConfigured:true, tokenEvents,
verticalResult:{ action, render, data }, ...(result.hitl ? { hitl: result.hitl } : {}) }`.
The `tokenEvents` already returned by the local branch feed the existing Token Chain UI unchanged.

---

## Data flow

All three tools share one shape (no new transport; reuses the P2/P3 local-bypass branch):

```
user msg → dispatchVerticalIntent → isLocalTool('demonstrate_*') === true
  → plugin.executeTool('demonstrate_*', params, ctx{userId,userToken,req,tokenEvents,sessionId,isAdmin})
      → resultStr = await executeBffTool({ name:<banking tool>, args, userId, userToken, req, tokenEvents, sessionId })
      → parsed = JSON.parse(resultStr)
      → branch on parsed.error → build narration text
      → return { result:{ text:<narration>, ...(hitl ? { hitl: parsed } : {}) }, render:'text' }
  → local branch wraps into response { reply, tokenEvents, verticalResult, ...(hitl ? {hitl} : {}) }
```

- **Token Chain:** `tokenEvents` is the same array passed into `executeBffTool`, which pushes the real
  exchange hops onto it. The local branch already returns `tokenEvents` → the existing Token Chain UI
  renders the real hops. **No chain UI change.**
- **`demonstrate_token_exchange`:** parse success → narrate the hop sequence derived from `tokenEvents`
  (T1 → RFC 8693 exchange → T2 aud/scope/act → backend). `render:'text'`.
- **`demonstrate_scope_denial`:** parse → expect `error:'mcp_authorization_denied'` → narrate which scope
  was missing and that the resource refused. `render:'text'`. If the call is instead PERMITted, the tool
  says so honestly ("expected a denial, but the call was permitted") — it never fakes a denial.
- **`demonstrate_hitl`:** first calls `get_my_accounts` to obtain two account IDs (parses
  `accounts[0].id` / `accounts[1].id`), then `create_transfer({from_account_id, to_account_id, amount:300})`.
  Parses the `mcp_hitl_required` 428 body and **translates** it to the UI shape: returns
  `result:{ text:<narration>, error:'hitl_required', hitlChallengeId: body.challengeId, hitl:{type:'consent'} }`.
  On the approve→retry (the agent re-runs the same message with `req.body.hitlChallengeId` set), the tool
  receives `ctx.hitlChallengeId` and passes `_hitl_challenge_id` in the `create_transfer` args so the
  pipeline verifies the receipt and PERMITs → the real transfer executes → narrate the receipt-aware PERMIT.

**Consent-modal wiring decision (LOCKED — requires a server-side dispatch extension, verified):** the UI
`kind:'vertical'` handler already opens `AgentConsentModal` when the response carries
`error:'hitl_required'` + `hitlChallengeId` (`demo_api_ui/src/components/AIAgent.js`), and approves via
`/api/mcp/decision/{hitlChallengeId}/approve` then re-sends with `hitlChallengeId`. **No UI change.** But
the existing local-bypass branch (`demoAgentLangGraphService.js:733-764`) hardcodes
`requiresConsent:false` and forwards only `education` — it does **not** forward a HITL challenge, nor pass
`hitlChallengeId` into the tool's `ctx`. So the plan extends that branch to: (a) include `hitlChallengeId`
in the `ctx` given to `executeTool`, and (b) when the tool's `result.error === 'hitl_required'`, return the
proven vertical-HITL envelope (`demoAgentLangGraphService.js:927-939`: `error, hitl, reply, action,
requiresConsent:true, hitlChallengeId, ...`). This is additive and REGRESSION-tracked, the same shared
file P2/P3 touched.

---

## Scope-denial mechanism (LOCKED with fallback)

**Primary: per-tool authz denial.** `demonstrate_scope_denial` calls a banking MCP tool whose required
scope the agent's *exchanged* token genuinely lacks, so the gateway returns `insufficient_scope` (403).
This teaches least-privilege enforcement **at the resource**.

The exchanged token's scopes are the **intersection** of the tool's candidate scopes with the user
token's scopes (`agentMcpTokenService.js` Path A), plus a mandatory `mcp:invoke`. A regular (non-admin,
non-investment) demo user's token does **not** carry `invest:read`, so the chosen target is
**`get_investment_balance`** (requires `invest:read` per `scope-topology.json`): the intersection yields no
`invest:read`, and the gateway denies with `insufficient_scope` + `required_scopes:['invest:read']`. This
is more reliably "missing" than `create_transfer`'s `write`/`transfer`, which a banking user may hold.

`executeBffTool` surfaces the denial as a parsed JSON object with an `error` field (e.g.
`insufficient_scope` / `mcp_authorization_denied`) and, where present, `required_scopes`. The tool narrates
the missing scope from that body.

**Plan-phase hard verification:** confirm the demo user's granted scopes do **not** include `invest:read`
(so the denial is genuine). If a different target is needed, pick any tool whose required scope the user
lacks. If — and only if — no per-tool denial is reproducible, **fall back** to the exchange-level
scope-count gate (`user-scopes-insufficient`, 403, `agentMcpTokenService.js:1373-1390`, triggered only
when `MIN_USER_SCOPES_FOR_MCP_EXCHANGE > 1`) and narrate that mechanism. The demo must show a **real**
denial; the spec forbids fabricating one.

---

## Safety

`demonstrate_hitl` is the only state-changing tool; safety centers there.

- **User's own seeded accounts only.** The transfer runs under the signed-in user's token via
  `executeBffTool({ name:'create_transfer' })`; the MCP/backend scope the call to the token's `sub`, so it
  can only move money between *that* user's banking-fallback-seeded accounts. No cross-user reach.
- **Fixed amount in the plain-consent band.** A hardcoded constant `$300` (≥ confirm `$250`, < step-up
  `$500`), well below the seeded balance, taken from the tool — **not** from `params`. The tool cannot be
  turned into an arbitrary-transfer tool. `$300` is required (not `$1`) because the MCP authz path PERMITs
  transfers under `$250` outright (see Architecture contract 4); below the threshold there is no HITL to
  demonstrate.
- **Resettable.** `reseedUserForVertical(userId, vertical)` (`demo_api_server/data/store.js:596`) wipes +
  reseeds the user's accounts. The narration documents that the demo moves resettable demo money and how
  to reset. The tool does **not** auto-reseed (that would erase the teaching artifact); reset is a
  user/dashboard action.
- **Not signed in → plain text reply**, no `executeBffTool` call (mirrors `inspect_token`'s no-token
  guard). Same guard for `demonstrate_token_exchange` / `demonstrate_scope_denial`.
- **Honest failure surfacing** (consistent with the D-2 fix). If the inner pipeline errors *unexpectedly*
  (not the expected denial/428), the tool reports the real error rather than masking it as success.
  `demonstrate_scope_denial` getting a PERMIT instead of a denial is surfaced honestly, not faked.
- **No raw tokens leave the server.** Narration describes claims (sub/aud/scope/act); the Token Chain
  renders via the existing sanitized `tokenEvents` path.

---

## Testing

Mirrors the P2/P3 split (unit mocks the pipeline; gated real suite exercises it).

**Unit** (`demo_api_server/src/__tests__/oauth-teaching.*.test.js`) — mock `executeBffTool`:

- `demonstrate_token_exchange`: stubbed success string + `tokenEvents` → asserts it calls `executeBffTool`
  with `name:'get_my_accounts'` and returns narration referencing the exchange hops.
- `demonstrate_scope_denial`: stub returns `{ error:'mcp_authorization_denied' }` → asserts denial
  narration; stub returns success → asserts the honest "expected denial, was permitted" message (no fake).
- `demonstrate_hitl`: stub returns the 428 / `hitl_required` body → asserts the tool surfaces `hitl` with
  `challengeId`; asserts the hardcoded amount is passed (not from `params`); not-signed-in
  (`ctx.userToken` absent) → text reply and **no** `executeBffTool` call.
- `getHeuristics()` matches "demonstrate token exchange / show me a real denial / do a real transfer"–style
  phrases and routes to the three tool names.

**Real, gated** (`demo_api_server/tests/real/shared/oauth-teaching-demonstrate.*.test.js`) — self-skips
without a live session; `node --check` is the gating verification for the new file:

- switches to `oauth-teaching`, signs in;
- `demonstrate_token_exchange` → response `tokenEvents` contain a real RFC 8693 exchange hop;
- `demonstrate_scope_denial` → a real denial object (per the mechanism the plan pins);
- `demonstrate_hitl` → response carries a real 428 / `challengeId` (asserts the challenge is **returned**;
  does not auto-approve in the test);
- `afterAll` restores the prior vertical (avoid vertical-switch bleed).

**UI:** no new heavy test — the Token Chain and consent modal are reused as-is; covered by the real suite
asserting the response fields plus manual verification. If a minimal consent bridge line proves necessary
(see Data flow), it is covered by manual verification, matching the P2/P3 `education` bridge approach.

---

## Out of scope (explicit)

- `api_key_demo` and `dual_token_demo` P1 stubs (remain stubs; separate work).
- Any `AIAgent.js` refactor (it is ~9700 lines; P4 adds at most one bridge line if verification requires).
- New SSE / streaming / AG-UI adoption.
- `nlIntentParser` THEME_VOCAB changes (the plugin owns its heuristics).
- Curriculum / ordered skill path (plan's P5) and `.claude/skills/oauth-teaching-agent/SKILL.md`.
- Auto-reseed after `demonstrate_hitl` (reset is a user/dashboard action).

---

## Files touched (anticipated)

- `demo_api_server/config/verticals/oauth-teaching/index.js` — three real `demonstrate_*` local tools,
  add their names to `LOCAL_TOOLS` / `TOOLS`, heuristics for the demonstrate phrases.
- `demo_api_server/config/verticals/oauth-teaching/manifest.json` — `render` map entries if any tool needs
  a non-text render (default `text`).
- `demo_api_ui/...` — **only if** plan verification finds the `kind:'vertical'` consent wiring missing a
  field: one minimal consent bridge line (mirrors the P2/P3 `education` bridge). Otherwise no UI change.
- `demo_api_server/src/__tests__/oauth-teaching.*.test.js` — unit tests for the three tools.
- `demo_api_server/tests/real/shared/oauth-teaching-demonstrate.*.test.js` — gated real suite.

Reuses (no change): `executeBffTool` (`bffMcpToolExecutor.js`), the local-bypass branch in
`demoAgentLangGraphService.dispatchVerticalIntent`, the existing Token Chain UI, `AgentConsentModal` and
the existing 428 approve→retry path, `reseedUserForVertical` (`data/store.js`), the banking MCP tool
registry (`get_my_accounts`, `create_transfer`).

---

## Plan-phase verification checklist (carry into writing-plans)

1. **Scope-denial reproducibility:** confirm a banking tool whose required scope the exchanged token
   lacks; otherwise fall back to the exchange-level scope-count gate. (Mechanism is real either way.)
2. **Consent wiring:** verify the field the `kind:'vertical'` handler reads for a 428 challenge; reuse if
   present, add one minimal bridge line if not.
3. **`executeBffTool` HITL body fields:** confirm `challengeId` / `_hitl_challenge_id` names on the parsed
   428 body and on the approve→retry replay (`AIAgent.js` ~7042, `mcpToolAuthorizationService`).
4. **Exact banking tool names** from the registry for the read call and the transfer call.
5. **Fixed transfer amount** chosen below the seeded balance and above/below thresholds as intended to
   force the 428 (transfers always challenge, so any positive amount works; pick a small fixed value).
