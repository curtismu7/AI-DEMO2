# Bug Tracker

Living doc. Rerun audit, append new pass, update status on old entries. Do not delete closed entries — mark Fixed with date/PR.

## Status legend
- 🔴 Open
- 🟡 In progress
- 🟢 Fixed
- ⚪ Won't fix / accepted risk

---

## Pass 1 — 2026-08-15

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 1 | Critical | 🟢 Fixed | TOCTOU overdraft race in agent transfers/withdrawals | `demo_api_server/services/mcpLocalTools.js:401-408`, `:339-345` |
| 2 | High | 🟢 Fixed | Agent-restriction gate trusts unauthenticated header | `demo_api_server/middleware/agentRestrictionsGate.js:110-111` |
| 3 | High | 🟢 Fixed | Cross-caller tool-list leak via unkeyed global cache | `demo_mcp_proxy/server.js:14,108-120` |
| 4 | Medium | 🟢 Fixed | Admin "$0 transaction limit" silently ignored (`\|\|` vs finite-check) | `demo_api_server/routes/transactions.js:476` vs `demo_api_server/routes/admin.js:540-543` |
| 5 | Medium | 🟢 Fixed | UC18 rate limiter race — Groovy port not thread-safe | `ping-gateway/scripts/groovy/uc18-rate-limit.groovy:101-127` |

### 1. TOCTOU overdraft race in agent transfers/withdrawals — Critical
`create_transfer`/`create_withdrawal` (in-process fallback path used when the WebSocket MCP server is down) check balance, `await` a step-up check, then call `dataStore.updateAccountBalance()` directly — no locking, no funds re-check:
```js
if (fromAccount.balance < rounded) return { error: `Insufficient balance...` };
const transferStepUp = checkLocalStepUp('transfer', rounded, req);
if (transferStepUp) return transferStepUp;
await dataStore.updateAccountBalance(from_account_id, -rounded);
```
`store.js`'s `applyTransfer()` (used by the real `POST /api/transactions` route) exists specifically to close this hole — its own doc comment names this exact race. `updateAccountBalance()` does no funds check and no locking.
**Trigger:** two concurrent agent tool calls transferring/withdrawing from the same account (retried assistant turn, overlapping chat turns) both pass the balance check before either mutates → negative balance / money created from nothing.
**Fix:** route both tools through `dataStore.applyTransfer()` instead of `updateAccountBalance()`.
**Fixed:** PR [#1808](https://github.com/curtismu7/AI-DEMO2/pull/1808) — rewired both handlers through `applyTransfer()`, same locked path the REST route uses. Verified: full suite 9476/9476 passed.

### 2. Agent-restriction gate trusts unauthenticated header — High
Mounted on `/api/accounts` and `/api/transactions` **before** `authenticateToken` (`server.js:1303-1304`):
```js
const agentSub = req.headers['x-agent-sub'];
if (!agentSub) return next();
```
Every other failure mode in this file is fail-closed (worker-token fetch fails → restrict, PingOne lookup errors → restrict, exception → restrict) except the entry condition itself, which trusts a raw client-supplied header never cross-checked against the verified token's RFC 8693 `act` claim (`req.user.actor`).
**Trigger:** a request that simply omits `X-Agent-Sub` skips the entire restriction-tier check — a "restricted" agent gets full write access.
**Fix:** derive agent-originated status from the verified token's `act` claim post-auth, not a pre-auth header.
**Fixed:** PR [#1810](https://github.com/curtismu7/AI-DEMO2/pull/1810) — `agentSub` now derived from `req.user?.actor`; middleware mount order fixed so `authenticateToken` runs first. Verified: full suite 9474/9474 passed, regression test added for forged header.

### 3. Cross-caller tool-list leak via unkeyed global cache — High
```js
let _toolCache = null;
...
if (!_toolCache) {
  const result = await mcpRpc('tools/list', {}, bearerFrom(req));
  _toolCache = result.tools || [];
}
return send(res, 200, { tools: _toolCache });
```
Single process-wide cache, no key on caller identity. Upstream `tools/list` (`demo_mcp_gateway/src/index.ts:437-521`) is scope/vertical-dependent — different bearer tokens legitimately get different lists.
**Trigger:** user A (broad scopes) calls `GET /tools` first; user B (restricted scopes/vertical) gets A's cached list back until an error clears it — over- or under-exposes available tools.
**Fix:** key the cache by bearer token / vertical, or drop caching on this endpoint.
**Fixed:** PR [#1805](https://github.com/curtismu7/AI-DEMO2/pull/1805) — cache replaced with a `Map` keyed by SHA-256 of the bearer token. Verified manually against a stub upstream (no existing automated tests for this file).

### 4. Admin "$0 transaction limit" silently ignored — Medium
`admin.js` allows and persists `0` as a valid hard limit:
```js
if (Number.isFinite(parsedMax) && parsedMax >= 0)  // admin.js:540-543, accepts 0
```
but enforcement reads it with `||`:
```js
const MAX_TRANSACTION_AMOUNT = parseFloat(configStore.getEffective('max_transaction_amount')) || 1000;
```
`parseFloat('0')` is `0`, falsy → `0 || 1000` evaluates to `1000`.
**Trigger:** admin sets limit to `0` (demo "freeze all transactions" control) → default $1000 silently reinstated instead of a hard block.
**Fix:** `Number.isFinite(x) ? x : 1000` instead of `||`.
**Fixed:** PR [#1816](https://github.com/curtismu7/AI-DEMO2/pull/1816). Verified: 24/24 scoped tests pass (new test proves `0` now blocks transactions), full suite 9475/9598 pass (0 failed).

### 5. UC18 rate limiter race — Groovy port not thread-safe — Medium
```groovy
if (globals._uc18Windows == null) { globals._uc18Windows = [:] }
def timestamps = (globals._uc18Windows[rlKey] ?: []).findAll { (it as long) > windowStart }
if (timestamps.size() >= maxRequests) { ... return 429 ... }
timestamps.add(now)
globals._uc18Windows[rlKey] = timestamps
```
Check-then-act on shared mutable `globals` map, unsynchronized. PingGateway/IG is multi-threaded, unlike the Node counterpart (`demo_mcp_gateway/src/rateLimit.ts:8-9`, single-threaded event loop — its "safe for single-process gateways" comment doesn't carry over to this Groovy port).
**Trigger:** concurrent `tools/call` bursts for the same agent+tool within one window (fan-out call or abuse script) → more than `maxRequests` (default 20/60s) get through.
**Fix:** synchronize the compound read-check-write per `rlKey`, or use an atomic/concurrent structure instead of a bare Groovy map.
**Fixed:** PR [#1813](https://github.com/curtismu7/AI-DEMO2/pull/1813) — wrapped read-check-append-write in `synchronized (globals)`, 429 response built outside the lock. No test infra exists for `ping-gateway/scripts/groovy/*`; verified by manual review (lock scope, no conflicting lock order with sibling scripts, single-threaded semantics unchanged).

---

## Pass 2 — 2026-08-15

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 6 | High | 🟢 Fixed | RAR grant-match falls back to wrong grant on spec-shaped `authorization_details` | `demo_mcp_gateway/src/rarEnforce.ts:50-55` |
| 7 | High | 🟢 Fixed | Non-numeric `TransactionAmount` silently becomes 0, bypasses all dollar-based PDP gates | `demo_authz_server/routes/decision.js:779,806,849,874-875` |
| 8 | High | 🟢 Fixed | Dead AG-UI tool-call hooks report "run failed" after a transfer already executed | `pydantic_agent/src/agui_emitter.py:18,35-41,52-59` |
| 9 | High | 🟢 Fixed | XSS via unescaped `dangerouslySetInnerHTML` in JSON viewer | `demo_api_ui/src/components/ProtocolPlayground/JSONViewer.jsx:11-36` |
| 10 | Medium | 🟢 Fixed | Admin audit logger arg-shape mismatch drops all audit event data | `demo_api_server/services/adminAuditService.js:26-186` vs `exchangeAuditStore.js:15-22` |

### 6. RAR grant-match falls back to wrong grant — High
`enforceRarSubset()` (RFC 9396 RAR intent-subset check, `REQUIRE_RAR_INTENT`) is meant to deny any tool call not covered by the caller's granted `authorization_details`:
```js
const grant = details.find((d) => (d.actions ?? []).includes(toolName) || d.tool === toolName) ?? details[0];
if (grant.tool && grant.tool !== toolName && !(grant.actions ?? []).includes(toolName)) {
  return { ok: false, reason: `tool "${toolName}" is not in the granted authorization_details` };
}
```
When no grant matches, it silently falls back to `details[0]` — the first grant, regardless of relevance. The mismatch guard only fires `if (grant.tool && ...)`, but standard RFC 9396 grants carry `actions`, not `tool` (that field is this demo's own BFF addition). Any spec-shaped grant with only `type`/`actions` skips the guard entirely, falling through to amount/payee checks against the *wrong* grant. Shared by both HTTP (`middleware/authorizeMcpRequest.ts:794`) and WebSocket (`pingAuthorizeGuard.ts:276`) transports.
**Trigger:** caller holds a standard-shaped `{actions:['transfer'], amount:100, payee:'acct_456'}` grant, calls an unrelated tool whose args happen to satisfy the leftover amount/payee checks → `enforceRarSubset` returns `ok:true` for a tool action never granted.
**Fix:** deny outright when `details.find(...)` returns nothing; don't fall back to `details[0]`.
**Fixed:** PR [#1806](https://github.com/curtismu7/AI-DEMO2/pull/1806). Verified: `rarEnforce.test.ts` 9/9 passed (1 new case), `authzPosture.test.ts` 30/30 passed.

### 7. Non-numeric `TransactionAmount` bypasses PDP dollar gates — High
```js
const amount = parseFloat(TransactionAmount) || 0;
const hasAmount = TransactionAmount !== '';
```
`hasAmount` is true for any non-empty string, but `amount` collapses to `0` for any non-numeric value. The ceiling check (`:779`) and tier check (`:849`) both skip on `isNaN`, and step-up/HITL checks (`:874-875`) evaluate `0 >= threshold` → false. Net effect: a malformed `TransactionAmount` sails through PERMIT with no ceiling, tier, step-up, or HITL consent applied — opposite of this PDP's stated fail-closed design elsewhere in the same file.
**Trigger:** a write-tool call reaches `decision.js` (the authoritative PDP, callable directly) with `TransactionAmount: "abc"` → every dollar-based gate is silently skipped.
**Fix:** treat non-empty-but-unparseable amount as invalid input → DENY, not `0`.
**Fixed:** PR [#1809](https://github.com/curtismu7/AI-DEMO2/pull/1809) — guard added returning `invalid_transaction_amount` DENY for write tools before ceiling/tier/step-up checks. Verified: 222/223 pass (1 pre-existing unrelated failure confirmed via `git stash` on unmodified code), 2 new tests added.

### 8. Dead AG-UI tool-call hooks mask completed transfers as failures — High
`on_tool_start`/`on_tool_args`/`on_tool_end` exist in `pydantic_agent/src/agui_emitter.py` but have zero call sites in `run_handler.py`/`bff_tool_adapter.py` (unlike `openai_agent`'s equivalents, which are wired and set `_any_tool_call = True`). `_any_visible_output` is only set by non-empty text deltas:
```python
async def on_run_end(self) -> None:
    if not self._any_visible_output:
        await self.on_error("The model didn't return a usable response...")
```
**Trigger:** model executes a money-moving tool (e.g. `create_transfer`, side effect already applied) but emits no trailing narration text this turn (common with small local models on this repo's LLM proxy) → client is told the run *failed* even though the transfer already happened, risking a user retry / double-transfer.
**Fix:** wire the tool-call hooks into the pydantic_ai tool path, or set `_any_visible_output` from tool execution the way `openai_agent` sets `_any_tool_call`.
**Fixed:** PR [#1811](https://github.com/curtismu7/AI-DEMO2/pull/1811) — `bff_tool_adapter.py` now emits `TOOL_CALL_START`/`TOOL_CALL_END` around each BFF tool call, reusing existing `_any_visible_output` wiring in `agui_emitter.py`. Verified red-green: 20/20 new+existing tests pass; 8 unrelated pre-existing `test_run_handler.py` failures confirmed present with or without this change via `git stash`.

### 9. XSS via unescaped `dangerouslySetInnerHTML` in JSON viewer — High
```js
let html = line
  .replace(/"([^"]*)"(\s*):/g, '<span class="json-key">"$1"</span>$2<span class="json-colon">:</span>')
  ...
return <div key={line} dangerouslySetInnerHTML={{ __html: html }} />;
```
The regex tokenizer wraps JSON tokens in `<span>` markup but never HTML-escapes `<`, `>`, `&` in the underlying values first. Rendered via `ActivityPanel.jsx:96` for every raw HTTP response in Protocol Playground (PAR/authorize/token calls).
**Trigger:** any response field (e.g. `error_description`) containing `<img src=x onerror=alert(1)>` renders as live HTML/JS instead of text.
**Fix:** HTML-escape line content before running the highlighting regexes, or switch to a token-array render like the sibling `components/shared/JsonHighlight.jsx` (which deliberately avoids `dangerouslySetInnerHTML` for this exact reason).
**Fixed:** PR [#1807](https://github.com/curtismu7/AI-DEMO2/pull/1807) — rewritten as a token-array React render (no `dangerouslySetInnerHTML`), same CSS classes/prop contract preserved. Verified: 6/6 tests passed (new XSS regression test asserting escaped output), `npm run build` clean.

### 10. Admin audit logger drops all event data — Medium
Five functions in `adminAuditService.js` (`logAdminTokenExchange`, `logAdminUserManagement`, etc.) call:
```js
writeExchangeEvent('admin_token_exchange', auditEvent);   // two args
```
but `exchangeAuditStore.js` declares `writeExchangeEvent(event)` — **one** param. The leading type-string becomes `event`; `{...event}` on a string spreads its characters into numeric keys, and the real object (adminSub, targetUserSub, action, result, IP) is dropped.
**Confirmed live call site:** `routes/adminAgentTools.js:178-185` — `DELETE /users/:userId` deletes a user + accounts/transactions, then logs via this broken path. The persisted compliance audit trail for that destructive action ends up empty/garbage; only an ephemeral `console.log` has the real fields.
**Fix:** drop the leading type-string argument (or fold `type` into the `auditEvent` object) so calls match the single-param signature.
**Fixed:** PR [#1815](https://github.com/curtismu7/AI-DEMO2/pull/1815) — leading type-string arg dropped from all 5 call sites; `type` field was already set on each `auditEvent`, matching the convention every other `writeExchangeEvent` caller uses. Verified red-green (new test fails pre-fix with spread-string garbage, passes post-fix); full suite 9476/9602 pass (6 pre-existing unrelated flakes).

### Also found in pass 2, not in top 5 (verified, logged for awareness — not yet tracked with a number)
- `demo_api_ui/src/components/AIAgent.js:1856-1911` — no staleness guard on `fetchLiveAccounts`; rapid vertical-switching can apply an older vertical's accounts last (Medium).
- `langchain_agent/src/agent/langchain_mcp_agent.py:1109-1149` — stale OAuth/HITL challenge has no expiry check, hijacks every subsequent reply in a session until the user completes that exact flow (Medium).
- `demo_authz_server/ruleStore.js:66-68` — admin-editable `hitlThresholdUsd` is persisted and shown as live-overridden but `decision.js` Rule 4 actually reads separate env vars; the control is dead (Medium).

---

## Pass 3 — 2026-08-15

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 11 | Critical | 🟢 Fixed | Tool-call name/args/id discarded on every real tool call (openai_agent) | `openai_agent/src/run_handler.py:234-240` |
| 12 | High | 🟢 Fixed | `/api/admin/scope-audit` missing `requireAdmin` — any logged-in user can read/write PingOne scopes | `demo_api_server/routes/scopeAudit.js:42,118` |
| 13 | High | 🟢 Fixed | UC18 rate limiting enforced on HTTP only — WebSocket transport (primary ingress) bypasses it entirely | `demo_mcp_gateway/src/index.ts` (WS `tools/call`) vs `middleware/authorizeMcpRequest.ts:249-308` |
| 14 | High | 🟢 Fixed | `tool-error` stream chunk unhandled — UI hangs, run reports false success after a failed tool call | `mastra_agent/src/runHandler.ts:111-141` |
| 15 | High | 🟢 Fixed | JWT decode crashes on base64url `-`/`_` chars — silently hides decoded-token panel for real tokens | `demo_api_ui/src/services/tokenInspector.js:17-26` |

### 11. Tool-call name/args/id discarded on every real tool call — Critical
```python
raw = getattr(item, "raw_item", {})
tc_id = raw.get("call_id", uuid.uuid4().hex[:12]) if isinstance(raw, dict) else uuid.uuid4().hex[:12]
name = raw.get("name", "unknown") if isinstance(raw, dict) else "unknown"
args = raw.get("arguments", "{}") if isinstance(raw, dict) else "{}"
```
`item.raw_item` for a real function-tool call is a pydantic `ResponseFunctionToolCall`/`FunctionCallOutput` model, never a plain dict — confirmed against the installed `openai-agents` SDK internals. `isinstance(raw, dict)` is always `False` in practice, so every BFF tool call gets `toolCallName="unknown"`, empty args, and a random UUID as `toolCallId` on start, but empty string `""` on end.
**Trigger:** any turn where the model calls a BFF tool (e.g. `transfer_funds`). Start/end IDs never match → `AGUIEmitter._pending_tool_calls.pop()` returns `None` → call dropped from `_turn_tool_calls`, blinding the commitment-grounding guardrail → UI tool-call entry stuck at `status: 'running'` forever, labeled "unknown", no visible arguments. Happens on every single tool call in `openai_agent` mode.
**Fix:** extract `call_id`/`name`/`arguments` via `getattr(raw, "call_id", None)` with a dict fallback, mirroring the SDK's own `_extract_call_id` pattern.
**Fixed:** PR [#1824](https://github.com/curtismu7/AI-DEMO2/pull/1824) — verified against the real pinned `openai-agents` SDK internals, not mocked. 38/39 pass (1 pre-existing unrelated failure).

### 12. `/api/admin/scope-audit` missing `requireAdmin` — High
```js
app.use('/api/admin/scope-audit', authenticateToken, require('./routes/scopeAudit'));
// router.get('/resources', ...) and router.post('/scopes', ...) — neither gated by requireAdmin
```
Every other `/api/admin/*` route pairs `authenticateToken` with `requireAdmin` (confirmed in `admin.js`, `adminAgentTools.js`, `groupMembership.js`). This route is the outlier.
**Trigger:** any logged-in customer (not just an admin) can call `GET /api/admin/scope-audit/resources` (dumps every PingOne resource server + scopes via the Management API worker token) and `POST /api/admin/scope-audit/scopes` (creates a new OAuth scope on any PingOne resource — a live tenant write).
**Fix:** add `requireAdmin` at the mount point or per-route, matching the pattern used everywhere else under `/api/admin`.
**Fixed:** PR [#1826](https://github.com/curtismu7/AI-DEMO2/pull/1826). Verified: full suite 9505/9505 pass (1 pre-existing unrelated flake in isolation).

### 13. UC18 rate limiting bypassed entirely over WebSocket — High
The HTTP middleware's `tools/call` path checks `config.rateLimitEnabled` and calls the `SlidingWindowLimiter`, returning 429 on burst. The WS `tools/call` handler in `index.ts` (the gateway's documented primary ingress — "Accepts JSON-RPC over WebSocket from agent") runs straight from token validation into tool dispatch with zero rate-limit references anywhere in the file.
**Trigger:** an agent connects over WebSocket and sends `tools/call` bursts. The same calls over HTTP get throttled at `GATEWAY_RATE_LIMIT_MAX_REQUESTS`; over WS they're never throttled — full UC18 resource-exhaustion/cost-runaway protection is void for the primary channel.
**Fix:** add the same `SlidingWindowLimiter` check (keyed `sub:toolName`) to the WS `tools/call` branch, before `guardToolCall`.
**Fixed:** PR [#1825](https://github.com/curtismu7/AI-DEMO2/pull/1825) — HTTP and WS now share one `SlidingWindowLimiter` singleton. 23/23 scoped pass, `tsc --noEmit` clean. No harness exists to spin up the real WS server in a unit test; verified the load-bearing shared-singleton mechanism instead (noted in PR).

### 14. `tool-error` stream chunk unhandled in mastra_agent — High
`runHandler.ts`'s `fullStream` switch only handles `'text-delta' | 'tool-call' | 'tool-result' | 'error'`. A failed tool `execute()` (BFF timeout/non-2xx/abort) emits a distinct `'tool-error'` chunk per the underlying `ai` SDK — never `'tool-result'` — which this switch silently drops.
**Trigger:** a BFF tool call fails mid-run. `onToolStart` already set `anyVisibleOutput = true`; the dropped `tool-error` chunk means `onToolEnd` never fires for that call, so the UI entry (`useAgentState.js`) hangs at `status: 'running'` forever, AND `onRunEnd()` still emits `RUN_FINISHED` (not an error) since `anyVisibleOutput` is already true — a failed tool call (potentially a transfer) is reported as a successful run.
**Fix:** add an `else if (part.type === 'tool-error')` branch that calls `emitter.onToolEnd()` with an error so the UI entry resolves instead of hanging.
**Fixed:** PR [#1828](https://github.com/curtismu7/AI-DEMO2/pull/1828). Also found and logged (in TECH_DEBT.md, not fixed — out of scope) a pre-existing unrelated flake in the request-abort test harness. 29/32 pass on touched files (3 pre-existing unrelated), `tsc --noEmit` clean.

### 15. JWT decode crashes on base64url characters — High
```js
header: JSON.parse(atob(parts[0])),
payload: JSON.parse(atob(parts[1])),
```
`atob()` only accepts standard base64 (`+`/`/`); JWTs use base64url (`-`/`_`). Verified directly: `atob('YWJjZGVmZ2hpams-_')` throws `Invalid character`.
**Trigger:** any real PingOne-issued token whose header/payload segment contains `-` or `_` (near-certain at typical token length) throws inside `decodeJWT`'s try block, returning `{isValid:false}` for a perfectly valid token — silently hiding the decoded-token panel in Protocol Playground's `TokenInspector.jsx` and `ExecutionEngine.executeStep`. The existing test suite only uses a hand-crafted token that happens to avoid `-`/`_`, masking the bug. Same pattern also exists in `Dashboard.js`, `UserDashboard.js`, `UserDashboardPing2026.js`, `TokenInspectModal.jsx`, `TokenExchangePanel.js` (flagged for awareness, not filed separately).
**Fix:** replace `-`/`_` with `+`/`/` (and pad) before calling `atob`, or use a base64url-safe decode helper.
**Fixed:** PR [#1827](https://github.com/curtismu7/AI-DEMO2/pull/1827) — open, not yet merged.

### Also found in pass 3, not in top 5 (verified, logged for awareness)
- `demo_api_server/services/rfc9728ComplianceAuditService.js:366,405,462,500,704` — server-side `fetch('/.well-known/...')` with a relative URL throws immediately under Node's `fetch`; every RFC 9728 compliance audit run reports false-negative non-compliance regardless of real endpoint health (Medium).
- `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx:106-119` — StepCard "Execute" enabled-check reads the step's own completion instead of the previous step's; per-step execute buttons past step 1 are permanently disabled (Medium).
- `demo_mcp_gateway/src/authzPosture.ts:108` — `/health` posture check only inspects the legacy singular `authorizedActorClientId` field, not the newer plural `authorizedActorClientIds` array that real enforcement (`GatewayTokenPolicy`) prefers — false-positive "fail open" reported on a correctly-configured gateway (Medium, misreport only, not an actual PEP weakness).
- `demo_hitl_service/src/routes/challenges.js:30` — auth-bypass dev-mode warning uses raw `console.warn` instead of `teachLog`, skipping correlation-id/structured logging for the one signal that HITL auth was skipped (Medium; has a currently-failing repo test as proof: `hitl-teachlog-migration.test.js`).
- `demo_hitl_service/src/routes/challenges.js:127-139` — `respondedBy` is documented and store-supported (`challengeStore.resolve`'s 3rd arg) but never destructured/forwarded on `/respond`; approval records for money-transfer consent can never carry who approved it (Medium; not live-exploited today, no caller sends it yet).

---

## Carryover — pass 2 & 3 extras, now tracked

Previously logged as "found but not in top 5" (see full detail in the pass 2 / pass 3 sections above). Now assigned numbers so every verified bug gets fixed and tracked.

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 16 | Medium | 🟢 Fixed | `fetchLiveAccounts` has no staleness guard — rapid vertical-switching can apply an older vertical's accounts last | `demo_api_ui/src/components/AIAgent.js:1856-1911` |
| 17 | Medium | 🟢 Fixed | Stale OAuth/HITL challenge has no expiry check, hijacks every subsequent reply in a session | `langchain_agent/src/agent/langchain_mcp_agent.py:1109-1149` |
| 18 | Medium | 🟢 Fixed | Admin-editable `hitlThresholdUsd` persisted and shown live-overridden but never actually read by the PDP | `demo_authz_server/ruleStore.js:66-68` |
| 19 | Medium | 🟢 Fixed | Server-side relative `fetch()` throws immediately — every RFC 9728 compliance audit reports false-negative | `demo_api_server/services/rfc9728ComplianceAuditService.js:366,405,462,500,704` |
| 20 | Medium | 🟢 Fixed | StepCard "Execute" enabled-check reads the wrong step's completion — per-step buttons past step 1 permanently disabled | `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx:106-119` |
| 21 | Medium | 🟢 Fixed | `/health` posture check inspects only the legacy singular actor-client field, false-positive "fail open" report | `demo_mcp_gateway/src/authzPosture.ts:108` |
| 22 | Medium | 🟢 Fixed | Auth-bypass dev-mode warning uses raw `console.warn` instead of `teachLog`, skips correlation-id logging | `demo_hitl_service/src/routes/challenges.js:30` |
| 23 | Medium | 🟢 Fixed | `respondedBy` documented and store-supported but never captured on HITL approval | `demo_hitl_service/src/routes/challenges.js:127-139` |

**Fixed:** #16 PR [#1836](https://github.com/curtismu7/AI-DEMO2/pull/1836) (full suite 3053/3053 pass) · #17 PR [#1834](https://github.com/curtismu7/AI-DEMO2/pull/1834) (105+ pass) · #18 PR [#1832](https://github.com/curtismu7/AI-DEMO2/pull/1832) (wired to HITL_CONSENT tier only, STEP_UP left untouched; red-green verified) · #19 PR [#1837](https://github.com/curtismu7/AI-DEMO2/pull/1837) (71/71 scoped, 9510/9636 full) · #20 PR [#1833](https://github.com/curtismu7/AI-DEMO2/pull/1833) (6/6, red-green, build clean) · #21 PR [#1830](https://github.com/curtismu7/AI-DEMO2/pull/1830) (32/32, red-green, tsc clean) · #22+#23 PR [#1831](https://github.com/curtismu7/AI-DEMO2/pull/1831) (46/46 full `demo_hitl_service` suite).

---

## Pass 4 — 2026-08-15 (UI-focused)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 24 | High | 🟢 Fixed | atob() crashes on base64url JWT payloads in Token Exchange Inspector modal | `demo_api_ui/src/components/TokenInspectModal.jsx:5-14` |
| 25 | High | 🟢 Fixed | Same atob() crash — decoded-token section silently vanishes in Learning Hub | `demo_api_ui/src/components/education/TokenExchangePanel.js:251` |
| 26 | High | 🟢 Fixed | `useNewItems` stops detecting new items after any array reset (e.g. new agent run) | `demo_api_ui/src/hooks/useNewItems.js:14-26` |
| 27 | Medium | 🟢 Fixed | `useAgentCCTokenPrefetch` re-fetches every poll/SSE tick instead of once on mount | `demo_api_ui/src/hooks/useAgentCCTokenPrefetch.js:15,69` |
| 28 | Medium | 🟢 Fixed | Dead `tokenData` state — decoded token discarded, wasted fetch/decode work, live landmine | `demo_api_ui/src/components/Dashboard.js:72,417-451` |

### 24. atob() crashes on base64url JWT payloads — TokenInspectModal — High
```js
function decodeJwt(token) {
  try {
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (err) {
    return null;   // swallowed, not even logged
  }
}
```
Same root cause as bug #15 (fixed in `tokenInspector.js`) — `atob()` needs standard base64, JWTs use base64url. Called live from `TokenExchangeInspector.jsx` (`decodeJwt(exchange.subjectToken)`/`resultToken`).
**Trigger:** any exchanged token whose payload segment contains `-`/`_` throws, caught silently, modal renders `'(Unable to decode)'` with zero indication why — looks like a broken feature.
**Fix:** same base64url-to-base64 conversion already applied in `tokenInspector.js`.

### 25. Same atob() crash — TokenExchangePanel — High
```js
try { payload = JSON.parse(atob(parts[1])); } catch (_) {}
```
Feeds `live.userToken.payload` in the Learning Hub's "Live Session Token" tab, gated by `live.userToken?.payload &&`.
**Trigger:** payload with base64url chars → `payload` stays `null` → the entire decoded-token block (including the `may_act` delegation sub-view) silently vanishes from the panel, no error, no fallback.
**Fix:** same base64url conversion.
**Fixed:** #24+#25 PR [#1840](https://github.com/curtismu7/AI-DEMO2/pull/1840) — noted `tokenInspector.js`'s earlier PR #1192 fixed a different bug (return shape), not base64url; PR #1827 (bug #15) covers that separately. 2/2 scoped pass, full suite 3055/3055 pass, build clean.

### 26. `useNewItems` stops detecting new items after any array reset — High
```js
const prevLenRef = useRef(0);
useEffect(() => {
  const newCount = items.length - prevLenRef.current;
  if (newCount <= 0) return;
  prevLenRef.current = items.length;
  onNew(items.slice(-newCount));
}, [enabled, items]);
```
`prevLenRef` only advances on growth; never resets when the array is replaced by a shorter one. `demo_api_server/routes/agentRun.js` injects a fresh `STATE_SNAPSHOT` with empty `mcpTraffic`/`authorizeDecisions` arrays at the start of every new run, and `useAgentState.onStateSnapshot` does a full replace.
**Trigger:** run 1 accumulates 5 mcpTraffic entries (`prevLenRef=5`). Run 2 resets the array to `[]` then grows to 3 by the time it finishes → `newCount = 3-5 = -2` every tick → `onNew` never fires. MCP Traffic panel, Authorize Decision panel, and activity narration silently stop updating for run 2 (or any later run whose peak stays below the prior run's peak) — looks like the agent made no tool calls even though it did.
**Fix:** detect a shrink (`items.length < prevLenRef.current`) and treat it as a reset (`prevLenRef.current = 0`) before computing `newCount`, or compare array identity instead of length.
**Fixed:** PR [#1835](https://github.com/curtismu7/AI-DEMO2/pull/1835) — red-green verified (new test fails on pre-fix code with "Number of calls: 0"). 68 hook tests + 38 consumer tests pass, build clean.

### 27. `useAgentCCTokenPrefetch` re-fetches on every poll/SSE tick — Medium
Effect depends on `[tokenChain]`, but `tokenChain` (from `TokenChainContext`'s `useMemo`) gets a new identity on nearly every provider state change (15s poll, SSE events, history writes). The duplicate-prevention check runs only after fetch completes, not before.
**Trigger:** on any token-chain route, each poll/SSE tick re-renders the provider, giving `tokenChain` a new reference, re-running the effect and firing another `GET /api/tokens/agent-cc-preview` — indefinitely, contradicting the hook's own doc comment ("prefetch ... once on component mount").
**Fix:** depend on a stable reference (e.g. `tokenChain?.setTokenEvents`) instead of the whole context object, matching the pattern already used in `useCurrentUserTokenEvent.js`.
**Fixed:** PR [#1838](https://github.com/curtismu7/AI-DEMO2/pull/1838) — red-green verified (new test fails on pre-fix code). 11/11 pass, full suite 3052/3078 pass (2 pre-existing unrelated, confirmed via stash), build clean.

### 28. Dead `tokenData` state in Dashboard.js — Medium
```js
const [, setTokenData] = useState(null);   // value discarded!
...
setTokenData({ accessToken: decodeToken(response.data.accessToken), ... });
```
`tokenData` (the state value) is destructured away — only the setter kept — and never read anywhere else in the file. `fetchTokenData()` still does a real network round-trip and JWT decode on every dashboard mount and every token-modal open, thrown into the void; the modal actually shown fetches its own data independently.
**Trigger:** no current visible break (output is discarded), but wasted API calls + decode work on every mount, and the same unconverted-base64url `atob` bug exists here too — currently harmless only because its output is discarded; becomes a live landmine the moment someone wires `tokenData` back into the render (e.g. "fixing" the unused-state lint warning).
**Fix:** either delete the dead `fetchTokenData`/`decodeToken`/`setTokenData` plumbing, or wire `tokenData` into the modal it was clearly meant to feed.
**Fixed:** PR [#1839](https://github.com/curtismu7/AI-DEMO2/pull/1839) — deleted the dead plumbing; found and confirmed server-side that the fetched endpoints never return `accessToken` anyway (BFF pattern), so `decodeToken`'s branch was unreachable even before this fix. Full suite 3051/3075 pass, build clean.

---

## Pass 5 — 2026-08-15 (BFF-focused, demo_api_server)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 29 | Critical | 🟢 Fixed | `/api/self-service/users` POST has no admin check — any customer can self-grant `role: "admin"` | `demo_api_server/routes/selfServiceUsers.js:90-175` |
| 30 | Critical | 🟢 Fixed | A2A auth accepts unsigned/forged JWTs — sole gate never verifies signature | `demo_api_server/middleware/a2aPingOneBearer.js:24-26` |
| 31 | Critical | 🟢 Fixed | JWT algorithm confusion — verification `alg` read from attacker-controlled header (RS256→HS256 forgery) | `demo_api_server/services/tokenValidationService.js:139-141` |
| 32 | High | 🟢 Fixed | Plaintext passwords written to activity log — `Authorization` header redacted but request body isn't | `demo_api_server/middleware/activityLogger.js:112` |
| 33 | High | 🟢 Fixed | RFC 8707 resource-format validator regex rejects every resource the service itself defines | `demo_api_server/services/resourceIndicatorService.js:100-107` |

### 29. `/api/self-service/users` missing admin gate — Critical
```js
app.use('/api/self-service/users', authenticateToken, selfServiceUsersRoutes);
// POST handler accepts `role` from body, validated only as isIn(['customer','admin']) — no req.user.role check
```
Sibling handlers in the same file (`DELETE /:userId`, `GET /`) both explicitly gate on `req.user.role !== 'admin'`. The `POST /` handler doesn't, and forwards `role` straight into `pingOneUserService.createPingOneUser(...)` + `ensureAdminRoleAssignments(user.id)`.
**Trigger:** any logged-in customer POSTs `{email, username, ..., role: "admin"}` → gets back a new PingOne user with admin role assignments granted, no admin session involved.
**Fix:** add the same `req.user.role !== 'admin'` gate used by the sibling DELETE/GET handlers, or drop `role`/`ensureAdminRoleAssignments` from the self-service path entirely.
**Fixed:** PR [#1849](https://github.com/curtismu7/AI-DEMO2/pull/1849) — targeted gate (only blocks non-admin callers requesting `role:"admin"`; admin callers and normal customer signup unaffected). 5/5 scoped pass, full suite 9524/9650 pass (4 pre-existing unrelated, confirmed via isolation rerun).

### 30. A2A auth accepts unsigned/forged JWTs — Critical
```js
const decoded = decodeJwt(token);   // base64-decodes header+payload, NEVER checks signature
const clientId = claims.client_id || claims.cid || claims.sub || null;
req.a2aPingOne = { token, claims, clientId: String(clientId) };
```
This is the sole auth gate on the live A2A JSON-RPC route (mounted without session `authenticateToken`). `decodeJwt` never verifies against PingOne's JWKS, unlike `middleware/auth.js`'s `authenticateToken`.
**Trigger:** anyone crafts `header.payload.signature` with an arbitrary `client_id`/`sub` in the payload (signature bytes can be garbage), POSTs it as `Authorization: Bearer <forged>` → marked `isAuthenticated: true` under that identity. Full identity spoofing on A2A specialist endpoints.
**Fix:** verify the JWT signature/issuer (JWKS or PingOne introspection) before trusting any claim, matching `authenticateToken`'s pattern.
**Fixed:** PR [#1845](https://github.com/curtismu7/AI-DEMO2/pull/1845) — now verifies RS256 signature/issuer/expiry via the same JWKS helper `authenticateToken` uses; no new JWKS logic written. Logged in REGRESSION_PLAN.md §4. 10/10 scoped pass, full suite 756/760 pass (4 pre-existing unrelated, confirmed via isolation rerun).

### 31. JWT algorithm confusion (RS256→HS256 forgery) — Critical
```js
const { kid, alg } = decoded.header;   // UNVERIFIED header the caller sent
const verifyOptions = { algorithms: [alg || 'RS256'] };
```
Classic CWE-347: the verification algorithm allow-list is derived from attacker-controlled token content instead of being server-fixed. Backs `validatePingOneCoreToken` in JWT-signature-verification mode (an alt to introspection mode).
**Trigger:** attacker knows a valid `kid` (public via JWKS by design), crafts a token `{alg:"HS256", kid:"<real-kid>"}`, HMAC-signs it using the RSA public key's PEM string (also public) as the HMAC secret. `algorithms` becomes `['HS256']` from the forged header, and the "key" passed to `jwt.verify` is that same PEM — `jsonwebtoken` HMAC-verifies successfully. Full auth bypass with a self-forged token for any subject/claims.
**Fix:** hard-code `algorithms: ['RS256']` (or an explicit server-controlled allow-list of asymmetric algorithms only) — never read `alg` from the token header.
**Fixed:** PR [#1847](https://github.com/curtismu7/AI-DEMO2/pull/1847). Honest finding: `jsonwebtoken@9.0.3` already type-checks key material against algorithm family, so the literal RSA-PEM-as-HMAC-secret exploit was already blocked by the library in this version — the attacker-controlled allow-list was still a real CWE-347 defect fixed as defense-in-depth regardless. 3/3 scoped pass (regression-proof spy assertion confirmed failing on pre-fix code), full suite 759/763 pass (2 pre-existing unrelated).

### 32. Plaintext passwords in activity log — High
```js
requestBody: method === 'POST' || method === 'PUT' ? req.body : null,
```
Globally mounted. `Authorization` header is explicitly redacted two lines above — showing password exposure wasn't intended — but the request body isn't.
**Trigger:** user logs in / registers / changes password → activity log entry persists the plaintext password field, later viewable via the admin activity-log surface.
**Fix:** redact known sensitive fields (`password`, `newPassword`, etc.) from `requestBody` before storing, same treatment as the auth header.
**Fixed:** PR [#1844](https://github.com/curtismu7/AI-DEMO2/pull/1844) — redacts `password`/`currentPassword`/`newPassword`/`clientSecret`/`client_secret`/`workerClientSecret` (verified real field names via grep of auth/vault/setup routes, not guessed). 3/3 scoped pass, full suite also green.

### 33. RFC 8707 resource validator rejects every real resource — High
```js
const validPatterns = [
  /^https:\/\/.*\.pingdemo\.com\/$/,
  /^https:\/\/pingone\.com\/.*\/$/,
  /^https:\/\/auth\.pingone\..*\/.*\/$/
];
```
`RESOURCE_DEFINITIONS` defines the actual resource URIs on domain `ping.demo` (`enduser.ping.demo/`, `mcpserver.ping.demo/`, `https://admin-api.ping.demo/`, `https://config-api.ping.demo/`). None of the three regexes match any of them (wrong domain, two aren't even `https://`).
**Trigger:** `oauthService.exchangeCodeForToken` filters caller-supplied `resources` through this validator before appending RFC 8707 `resource` params — the filter always empties the list, silently dropping resource indicators from every code-exchange request. `routes/oauth.js`'s `validateResourceSelection` likewise rejects every legitimate resource.
**Fix:** correct the regex allow-list to match the actual `*.ping.demo` domains, and normalize the bare-hostname entries to include a scheme or drop the hard `https://` requirement for them.
**Fixed:** PR [#1843](https://github.com/curtismu7/AI-DEMO2/pull/1843) — no prior test coverage existed for this function, added 9 new tests. 9/9 pass, full suite 9529/9654 pass (2 pre-existing unrelated).

### Also found in pass 5, not in top 5 (verified, logged for awareness)
- `demo_api_server/routes/complianceAgentRoutes.js:16-42`, `routes/supportAgentRoutes.js:16-45` — identity taken from `req.body.userId` instead of the authenticated `req.agentContext.userId`; an authenticated user can act under a spoofed identity on the compliance/support agent init/message endpoints (Medium).
- `demo_api_server/routes/investment.js:16-28` — `accountId` path param is echoed back unvalidated; `GET /accounts/:accountId/portfolio` returns the caller's real portfolio mislabeled under whatever `accountId` was requested (Low/Medium).
- `demo_api_server/middleware/tokenErrorMiddleware.js:43-46` — operator-precedence bug misclassifies token type (`||`/`&&` bind tighter than `?:`); currently unmounted/unexploitable but would defeat a `system`-only gate if wired into a route (Medium).

---

## Pass 6 — 2026-08-15 (top 10, broad sweep)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 34 | Critical | 🟢 Fixed | Unauthenticated write access to live authorization policy in the default docker-compose deployment | `demo_authz_server/routes/rulesWrite.js:15-22` |
| 35 | High | 🟢 Fixed | HITL approval receipts are never single-use — replay within TTL enables a second transfer from one human consent | `demo_hitl_service/src/store/challengeStore.js`, `receiptVerification.js:55-116` |
| 36 | High | 🟢 Fixed | Workforce `request_time_off` accepts negative `days` — inflates PTO balance instead of rejecting | `demo_api_server/config/verticals/workforce/data.js:26-31` |
| 37 | High | 🟢 Fixed | P1AZ tier amount-ceiling backstop keyed on token scope instead of tool scope — effectively dead on standard traffic | `ping-gateway/scripts/groovy/p1az-decision.groovy:516` |
| 38 | Medium | 🟢 Fixed | Investment `deposit`/`withdraw` accept negative amounts, inverting the operation with no ceiling guard | `demo_api_server/config/verticals/investment/data.js:104-118` |
| 39 | Medium | 🟢 Fixed | CivicPermit `pay_fee` silently pays a different, unrelated fee on bad/mismatched `permitId` | `demo_api_server/config/verticals/government/data.js:14-23` |
| 40 | Medium | 🟢 Fixed | Non-constant-time secret comparison on AAM trust gate — timing side channel | `ping-gateway/scripts/groovy/aam-trail-stamp.groovy:27-28` |
| 41 | Medium | 🟢 Fixed | TOCTOU race on JWKS forced-refetch throttle — concurrent bad-`kid` burst defeats the 60s rate cap | `ping-gateway/scripts/groovy/jwks-token-validation.groovy:154-159` |
| 42 | Medium | 🟢 Fixed | pydantic_agent raises `RuntimeError` on tool policy-denial instead of `ModelRetry` — aborts run instead of reporting the real reason | `pydantic_agent/src/bff_tool_adapter.py:86-94` |
| 43 | Medium | 🟢 Fixed | openai_agent never closes an open text bubble before a tool call starts — UI ordering/merge glitch | `openai_agent/src/run_handler.py:223-252` |

### 34. Unauthenticated write access to live authorization policy — Critical
```js
function guardOk(req) {
  const expected = process.env.AUTHZ_ADMIN_TOKEN;
  if (!expected) return true;   // guard is a no-op when unset
  ...
}
```
The no-op fallback is justified by a comment assuming the server "binds 127.0.0.1 as a sidecar" — true for the k8s deployment, but `docker-compose.yml` explicitly sets `HOST: "0.0.0.0"` and publishes `9001:9001` to the host, and `AUTHZ_ADMIN_TOKEN` is never set anywhere in the repo (`.env`, compose, k8s — verified via full-repo grep). The `demo-auth` compose profile (which includes `authz-server`) is part of the normal always-up flow, not opt-in.
**Trigger:** with the stack running normally (`./run-docker.sh`), anyone reaching `localhost:9001` can `PUT /rules` with zero credentials, e.g. setting `create_transfer`'s `requiredScopes` to `[]` and it no longer being classified as a write tool — `decision.js` then skips scope enforcement AND the HITL/step-up gates entirely, persisted live to `rules-overlay.json` until someone notices or calls `/rules/reset` (also unauthenticated).
**Fix:** require `AUTHZ_ADMIN_TOKEN` whenever `HOST` isn't loopback (fail closed with a startup error), or default one in docker-compose the way other admin-facing services in this repo do.
**Fixed:** PR [#1859](https://github.com/curtismu7/AI-DEMO2/pull/1859) — `guardOk()` now fails closed (401) on any non-loopback bind with no token; k8s sidecar loopback case unaffected. Real dev-only default `AUTHZ_ADMIN_TOKEN` added to docker-compose.yml on both authz-server and BFF proxy. 6/6 scoped pass, 226/227 full (1 pre-existing unrelated).

### 35. HITL approval receipts not single-use — High
Once approved, a challenge stays `status:'approved'` until its 10-minute TTL or the 1-hour GC sweep. `verifyReceipt()` only checks status/expiry, never marks the challenge consumed — no equivalent to the codebase's own established "one-time use: consumed here" pattern used for pending-elicitation checks one block above in the same gateway file.
**Trigger:** agent gets a transfer challenge approved once by a human, then retries (or replays) the same `tools/call` with the identical `_hitl_challenge_id` before the TTL expires — verification passes again, discharging a second transfer from one approval. The repo's own replay test suite (`challenges.verify.test.js`) covers every cross-user/agent/tool/amount vector except this one.
**Fix:** transition the challenge to a terminal `consumed`/`spent` status on first successful `/verify`, and reject non-`'approved'` status the same way `'denied'`/`'expired'` are already rejected.
**Fixed:** PR [#1858](https://github.com/curtismu7/AI-DEMO2/pull/1858) — `store.consume()` added, called on first successful verify. 47/47 pass. Important finding: the *default* Node gateway path (`ff_mcp_gateway_pinggateway` OFF) never calls `/verify` at all and has an even bigger unpatched version of this hole — logged as a scoped follow-up in TECH_DEBT.md rather than expanding this PR's blast radius.

### 36. Workforce PTO negative-days inflation — High
```js
if (data.pto.balance < days) return { error: ... };
data.pto.balance -= days;
```
`days` comes straight from tool-call params with no server-side range check.
**Trigger:** `days: -5` passes `balance < days` (false), then `balance -= (-5)` INCREASES the balance instead of being rejected. Non-numeric `days` also passes (`balance < NaN` is always false) and corrupts `balance` to `NaN`.
**Fix:** validate `days > 0` and finite before the balance check/mutation.
**Fixed:** PR [#1855](https://github.com/curtismu7/AI-DEMO2/pull/1855) — red-green verified. Full suite 9578/9578 pass.

### 37. P1AZ tier ceiling backstop effectively dead — High
```groovy
def isWriteToolLocal = tokenScopes.tokenize(' ').contains('write')
if (txAmountLocal != null && isWriteToolLocal && txAmountLocal > maxAmountLocal) { return denyLocal('tier_amount_exceeded', ...) }
```
This is documented as the SOLE enforcement of the tier-based transfer ceiling (the script's own comment: "real P1AZ cannot map a PingOne group array to a tier"). It checks the caller's granted TOKEN scopes, but the standard inbound token on this route only ever carries the gateway-hop scope — never the literal `'write'` scope, which is a TOOL-level classification in `scope-topology.json` (88 write tools declare `requiredScopes:['write']` at the tool level, not token level).
**Trigger:** `isWriteToolLocal` is false for essentially all standard traffic, so `tier_amount_exceeded` never fires — a tier-restricted user's transfer/withdraw ceiling is silently unenforced.
**Fix:** derive `isWriteToolLocal` from the tool's own `requiredScopes` (already loaded as `toolEntry.requiredScopes` earlier in the same block), not from `tokenScopes`.
**Fixed:** PR [#1854](https://github.com/curtismu7/AI-DEMO2/pull/1854) — no test infra exists for this file; verified by cross-checking real tool classifications against `scope-topology.json` (write tools correctly flagged, read tools correctly excluded) and diff-scoped brace/paren balance.

### 38. Investment deposit/withdraw invert on negative amounts — Medium
```js
const amt = Number(amount) || 0;
portfolio.value = Number((portfolio.value + amt).toFixed(2));   // deposit — no ceiling guard
portfolio.value = Math.max(0, Number((portfolio.value - amt).toFixed(2)));  // withdraw — floor only
```
No sign constraint on `amount`.
**Trigger:** `deposit` with `amount: -50000` reduces the portfolio (an inverted withdrawal mislabeled as a deposit); `withdraw` with a negative amount increases the value with no ceiling (`deposit` also has no matching ceiling guard).
**Fix:** reject non-positive `amount` in both mutators before applying the delta.
**Fixed:** PR [#1856](https://github.com/curtismu7/AI-DEMO2/pull/1856). Full suite 9583/9583 pass.

### 39. CivicPermit pays wrong fee on bad permitId — Medium
```js
const item = data.fees.items.find((f) => f.permitId === permitId || f.id === permitId)
  || data.fees.items.find((f) => f.status === 'Outstanding');
```
Unlike every sibling vertical's mutator (which returns `null`/errors on no-match), this one silently falls back to whichever fee happens to be Outstanding first.
**Trigger:** a wrong/stale/typo'd `permitId` pays a DIFFERENT permit's fee instead of erroring, returning `status:'Paid'` as if the request succeeded.
**Fix:** return an error when `permitId` is supplied but matches nothing — no fallback.
**Fixed:** by another concurrent session (commit `eace36aaf`, not this session's work) — already on main before this pass ran; this pass's audit was against a stale branch point. Verified via existing `verticalMutatorIdHonour.regression.test.js`, 7/7 pass. No new PR needed.

### 40. AAM trust gate uses non-constant-time comparison — Medium
```groovy
def trustedCaller = internalSecret && request.headers.getFirst('X-BFF-Internal') == internalSecret
```
Every equivalent trust gate elsewhere in this codebase uses constant-time comparison (`p1az-decision.groovy` uses `MessageDigest.isEqual`; the Node BFF's own internal-secret helper explicitly documents why). Groovy `==` on strings short-circuits on first mismatched byte.
**Trigger:** anyone reaching the IG host port directly can time-probe `X-BFF-Internal` byte-by-byte to recover the shared secret and force AAM decisions to the permissive mock backend.
**Fix:** use `MessageDigest.isEqual` on UTF-8 bytes, matching `p1az-decision.groovy`'s existing pattern.
**Fixed:** PR [#1852](https://github.com/curtismu7/AI-DEMO2/pull/1852) — no test infra exists for this file; verified by code review, byte-for-byte pattern match against `p1az-decision.groovy`'s working implementation.

### 41. JWKS forced-refetch throttle has a TOCTOU race — Medium
```groovy
if (nowMs - lastForced > 60_000L) { globals._jwksForcedFetchAt = nowMs; jwk = findJwk(fetchJwks(true), kid) }
```
Unsynchronized shared `globals` on a multi-threaded IG runtime; the check-then-set isn't atomic.
**Trigger:** a burst of concurrent requests with an unknown `kid` can all read `lastForced` before any writes it back — all N threads pass the throttle and each issues a forced HTTPS fetch to the JWKS endpoint, the exact amplification the throttle exists to prevent (just needs concurrency instead of sequential requests).
**Fix:** guard the check-and-set with `synchronized` or an `AtomicLong`/CAS so only one thread per 60s window wins the forced refetch.
**Fixed:** PR [#1853](https://github.com/curtismu7/AI-DEMO2/pull/1853) — wrapped in `synchronized (globals)`, matching the identical pattern already used for `uc18-rate-limit.groovy`'s analogous TOCTOU fix. Verified by code review (no test infra exists for this file).

### 42. pydantic_agent aborts run on policy denial instead of reporting it — Medium
```python
if resp.status_code >= 500 or resp.status_code in (408, 429):
    raise ModelRetry(msg)
raise RuntimeError(msg)   # includes 403 policy denials
```
The class docstring says recoverable failures should let the model "recover or report the error," but any other 4xx (e.g. a 403 P1AZ-blocked transfer) raises a bare `RuntimeError`, which `pydantic_ai` doesn't special-case — it propagates uncaught to the top-level generic error handler, discarding the real denial reason. The other three agents (openai, langchain, mastra) all surface the real error to the model instead.
**Trigger:** user asks pydantic_agent to make a transfer that trips a policy limit; instead of the model explaining the denial, the user sees a generic "internal error" message and the run terminates.
**Fix:** raise `ModelRetry(msg)` for 4xx denial responses too (or return an error string like the sibling agents).
**Fixed:** PR [#1860](https://github.com/curtismu7/AI-DEMO2/pull/1860) — verified `ModelRetry` semantics against real pydantic_ai docs first (hands the message to the model as a `RetryPromptPart`, doesn't blindly re-invoke the tool). 7/7 pass.

### 43. openai_agent doesn't close text bubble before tool call — Medium
The `tool_call_item` branch calls `emitter.on_tool_start(...)` with no check of `_current_message_id`, unlike `mastra_agent`/`langchain_agent`'s equivalents, which both explicitly close the open text message before emitting `TOOL_CALL_START`.
**Trigger:** model streams lead-in text, then emits a tool call in the same turn while a text bubble is still open — `TEXT_MESSAGE_END` never fires at the tool-call boundary, and when text resumes after the tool result, `on_llm_start` is skipped since the stale message id is still set — pre- and post-tool text silently merge into one bubble with the tool-call event racing in the middle.
**Fix:** close the current message (`on_llm_end()`) before `on_tool_start` when `_current_message_id` is set, mirroring the other agents.
**Fixed:** PR [#1857](https://github.com/curtismu7/AI-DEMO2/pull/1857). 4/5 pass (1 pre-existing unrelated, confirmed via git stash).

### Also found in pass 6, not in top 10 (verified, logged for awareness)
- `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx:606-610` — token-expiry badge only recomputes `isExpired` when the `exp` claim value changes, not on wall-clock passage; stays "✓ Active" indefinitely after real expiry if the token isn't refreshed. Display-only, contrast with the correct inline-computed pattern in `TokenCard.jsx` (Medium).

---

## Pass 7 — 2026-08-16 (broad sweep)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 44 | Critical | 🟢 Fixed | Undeclared `emit` reference crashes the entire `demo_api_server` process on any elicitation flow | `demo_api_server/services/mcpWebSocketClient.js` (`ws.on('message')` handler) |
| 45 | High | 🟢 Fixed | Banking-vertical resource-server tools have no per-user scoping — IDOR, masked today by single-user seed data | `demo_mcp_resource_server/src/tools/registry.ts:78`, `bankingToolHandler.ts:15-20`, `bankingDb.ts:104-134` |
| 46 | High | 🟢 Fixed | Agent-route session refresh reintroduces the concurrent refresh-token race `tokenRefresh.js` was built to prevent | `demo_api_server/middleware/agentSessionMiddleware.js:13-25` |
| 47 | High | 🟢 Fixed | `approve_purchase_order` approves the wrong PO and ignores its own required `amount` param | `demo_api_server/config/verticals/manufacturing/tools.js:82-91` |
| 48 | High | 🟢 Fixed | `pay_bill` with no id defaults to an already-paid bill instead of the first outstanding one | `demo_api_server/config/verticals/healthcare/tools.js:88-95` |
| 49 | Medium | 🟢 Fixed | CIBA misconfiguration silently drops the HITL notification instead of falling back to log mode as documented | `demo_hitl_service/src/notifier.js:53-57` |
| 50 | Medium | 🟢 Fixed | `cash_out_store_credit` has no balance cap — can report cashing out far more than the actual store-credit balance | `demo_api_server/config/verticals/retail/tools.js:44,212-215` |
| 51 | Medium | 🟢 Fixed | Shared `abortRef` lets an aborted run's cleanup clobber the current run's controller, breaking logout/unmount cancellation | `demo_api_ui/src/hooks/useAgentRun.js:118-136,260-271` |
| 52 | Medium | 🟢 Fixed | `p1azEnabled` skips the admin-config strict-boolean gate — a non-boolean payload can silently disable the live PDP | `demo_mcp_gateway/src/adminConfig.ts:100,115-126,169-188` |

### 44. Undeclared `emit` crashes the entire server process — Critical
```js
if (msg.method === 'elicitation/create') {
  emit({ phase: 'elicitation_requested', elicitationId: msg.id, ... });
  createElicitationPromise(msg.id, 60000)...
```
`emit` is never declared, imported, or destructured anywhere in this file. Elicitation is a real, wired feature (client declares `elicitation: {}` capability; `server.js` has a live `/resolve-elicitation`-style endpoint), not dead code.
**Trigger:** any MCP tool call that causes the server to send a server-initiated `elicitation/create` JSON-RPC message over the WebSocket hits this line → `ReferenceError: emit is not defined` inside the `ws.on('message')` handler → `server.js`'s `process.on('uncaughtException', ...)` unconditionally calls `process.exit(1)` → the entire `demo_api_server` process crashes for every user, not just the triggering request.
**Fix:** wire this to the actual SSE/event publisher used elsewhere for MCP flow events (`mcpFlowSseHub.publish`/`mcpSsePublisher`), or pass an `emit` callback into the caller.
**Fixed:** PR [#1869](https://github.com/curtismu7/AI-DEMO2/pull/1869) — red-green verified (reproduced the exact `ReferenceError` crash before fixing). Threaded `deps.emit` (already used by `mcpToolPipeline.js` for every other phase event) down as an optional `opts.emit`. 18 suites, 117 tests, 0 failures.

### 45. Banking accounts IDOR — no per-user scoping — High
```ts
if (BANKING_TOOL_NAMES.has(toolName)) return dispatchBankingTool(toolName, args);  // no subject/token forwarded
```
```ts
// bankingDb.ts
listAccounts()  // SELECT * FROM accounts ORDER BY id — all users, no WHERE
getAccount(id)  // SELECT * FROM accounts WHERE id = ? — no userId filter
```
`Account` has an explicit `userId` column and the tool descriptions promise "for the authenticated user," but identity is never checked — `index.ts` already resolves `decoded.sub` and passes it into `dispatch()`, `registry.ts` just drops it before calling `dispatchBankingTool`. Banking is the only vertical in the resource server with per-user ownership modeled (confirmed: none of the other 7 verticals' DB files have a `userId` column).
**Trigger:** any caller with `banking:read` scope can call `get_banking_account` with a guessed/enumerated `account_id` and get another user's balance, or call `list_banking_accounts` and get every account in the database. Masked today only because seed data has exactly one user.
**Fix:** thread `subject` through `registry.ts` → `dispatchBankingTool` → `listAccounts(userId)`/`getAccount(id, userId)`, filter both queries by `userId`.
**Fixed:** PR [#1863](https://github.com/curtismu7/AI-DEMO2/pull/1863) — tests seed a 2nd user, prove cross-user isolation. 156/159 pass (3 pre-existing unrelated, confirmed via stash). Note: no live UI consumer calls these tools today, but real PingOne `sub` claims are UUIDs — flagged for whoever wires this up next that seed data won't match unless updated.

### 46. Agent-route refresh reintroduces concurrent refresh-token race — High
```js
const refreshOAuthSession = async (req) => {
  const tokens = req.session && req.session.oauthTokens;
  ...
  const tokenData = await oauthUserService.refreshAccessToken(tokens.refreshToken);
```
Comment claims this "mirrors" `middleware/tokenRefresh.js`'s `refreshIfExpiring`, but omits its `_refreshInFlight` dedup Set and `_refreshBlacklist` Map, which exist specifically to stop concurrent refreshes from reusing an already-rotated refresh token. Mounted on `/api/agent`, `/api/admin-agent`, `/api/ops-agent`, `/api/a2a`, `/api/support-agent`, `/api/compliance-agent` — none covered by the global proactive-refresh path (`/api/demo-agent` is, `/api/agent` is not).
**Trigger:** two concurrent requests on any of these routes with an expired token (chat send + background poll, or a double-click) both call `refreshOAuthSession` with the same still-current refresh token. PingOne rotates on use, so the second call gets `invalid_grant` → bare 401 `session_expired`, forcing full re-auth even though the first refresh succeeded moments earlier.
**Fix:** reuse the in-flight/blacklist guard from `middleware/tokenRefresh.js` (or call `refreshIfExpiring` directly) instead of a standalone unguarded refresh.
**Fixed:** PR [#1870](https://github.com/curtismu7/AI-DEMO2/pull/1870) — added in-flight Map + blacklist Map, concurrent callers await the in-flight refresh. 9/9 scoped pass, 9575/9700 full (2 pre-existing unrelated).

### 47. `approve_purchase_order` approves the wrong PO, ignores amount — High
```js
if (!_item && !_id) _item = _arr.find((r) => r.status === 'Pending') || _arr[0];
```
Seed statuses are `"Pending Approval"`/`"Approved"`/`"Delivered"`, never `"Pending"` — the status match is dead code, so the fallback silently degrades to `_arr[0]` regardless of that PO's actual state. The schema marks `amount` required (comment: "approve a $300 purchase order") but the handler never reads it — no validation against the found PO's total, and no guard against approving an already-`Delivered`/`Rejected` PO on either path.
**Trigger:** "approve a $300 purchase order" with no id → always approves `purchaseOrders[0]` regardless of stated amount or actual PO state.
**Fix:** match the literal `Pending Approval` status (or drop the dead branch), add a status guard before mutating on every path, validate `params.amount` against the found PO's total or drop it from the schema.
**Fixed:** PR [#1866](https://github.com/curtismu7/AI-DEMO2/pull/1866) — fixed dead status match, added status guard on the explicit-id path only (a discovered cross-vertical test invariant requires the no-id amount-driven fallback to always complete, never error — scoped accordingly). `amount` left deliberately unvalidated against total, documented in the PR. 302/302 + 192/192 pass.

### 48. `pay_bill` defaults to an already-paid bill — High
```js
if (!_billId) { const _bills = store.get(userId).billingHistory || []; _billId = _bills[0] && _bills[0].id; }
```
Comment says "first outstanding bill" but the code takes literal index `[0]` with no status filter — seed `billingHistory[0]` is already `status: "Paid"`; the real outstanding bills are elsewhere in the array.
**Trigger:** "pay my bill" with no id → re-marks the already-paid $20 bill as paid and reports success, while actual overdue balances go untouched.
**Fix:** filter for `status !== 'Paid'` before taking `[0]`.
**Fixed:** PR [#1865](https://github.com/curtismu7/AI-DEMO2/pull/1865) — also added a 4th Due bill to seed data since an existing chip-completion test needed 4 outstanding bills. 9/9 scoped, 191/191 wider pass.

### 49. CIBA misconfiguration silently drops HITL notification — Medium
```js
if (!CIBA_ENDPOINT || !CIBA_CLIENT_ID) {
  teachLog.warn('ciba not configured — falling back to log', ...);
  return;   // never actually emits the log-mode notification it claims to fall back to
}
```
The caller only logs on rejection (`.catch`), but this resolves normally, so no error signal fires either.
**Trigger:** `HITL_NOTIFY_MODE=ciba` set but `PINGONE_CIBA_ENDPOINT`/`HITL_CLIENT_ID` missing (partially-configured env) → a money-transfer HITL challenge is created, no CIBA push sent, no fallback log-mode notification with `approvalUrl` emitted, no error logged anywhere — looks like a hung transfer with no diagnostic trail pointing at the real cause.
**Fix:** in the missing-config branch, actually call through to the log-mode notification path instead of only warning and returning.
**Fixed:** PR [#1862](https://github.com/curtismu7/AI-DEMO2/pull/1862) — extracted a `_notifyViaLog()` helper shared by both the default log-mode branch and the CIBA-fallback branch. 48/48 pass.

### 50. `cash_out_store_credit` has no balance cap — Medium
```js
const _amt = (params && params.amount != null) ? params.amount : 50;
return { result: { cashedOut: _amt, ..., status: 'pending step-up' }, render: 'text' };
```
Never checks `_amt` against the real `storeCredit` balance (150 in seed data) and never decrements it.
**Trigger:** "cash out $50,000 of my store credit" reports `cashedOut: 50000` as pending-step-up success with no rejection, repeatably, balance never depleted.
**Fix:** clamp/reject `_amt` against the actual balance and decrement it on success.
**Fixed:** PR [#1867](https://github.com/curtismu7/AI-DEMO2/pull/1867). 3/3 scoped, 561/561 wider pass.

### 51. Shared `abortRef` breaks logout/unmount cancellation — Medium
```js
} finally {
  ...
  abortRef.current = null;   // unconditional, not identity-checked
  setIsRunning(false);
}
```
`useAgentRun` is instantiated once and shared across every send path (typed message, chip, HITL resume). An aborted run's `finally` unwinds asynchronously and unconditionally nulls `abortRef.current` with no check that it still belongs to that invocation.
**Trigger:** run A gets aborted by run B (e.g. sending a new message while a HITL modal's approve triggers a third run C); when A's aborted stream loop unwinds, it nulls out C's controller. `aguiAbort()` (called on logout/unmount) becomes a silent no-op — the actually-active stream keeps running past logout/navigation, still dispatching events into reset state.
**Fix:** `if (abortRef.current === controller) { abortRef.current = null; }` (and guard `setIsRunning(false)` the same way) instead of unconditional clearing.
**Fixed:** PR [#1864](https://github.com/curtismu7/AI-DEMO2/pull/1864) — red-green verified with a race-simulating test. Full suite 3070/3070 pass, build clean.

### 52. `p1azEnabled` skips the admin-config strict-boolean gate — Medium
`boolKeys` lists `requireActForAgentTools`/`intentTokenRequired`/`requireRarIntent`/`introspectionSimDown`; `devBypass`/`rateLimitEnabled` get their own dedicated 400-rejection. `p1azEnabled` is allowed as an admin-config key but isn't in any of these lists, so it falls through to a generic assignment with no type check or coercion.
**Trigger:** `POST /admin/config {"p1azEnabled": 0}` (a JSON number, not boolean) silently sets `config.p1azEnabled = 0` → `isP1AZActive()` evaluates falsy → disables the live PDP, routing every `guardToolCall`/`guardToolsList` into the local-scope-fallback path — exactly the malformed-payload case the strict-boolean gate exists to reject with 400 for its sibling keys.
**Fix:** add `p1azEnabled` to the strict-boolean validation/coercion list, matching `rateLimitEnabled`/`devBypass`.
**Fixed:** PR [#1861](https://github.com/curtismu7/AI-DEMO2/pull/1861). 31/31 scoped pass.

---

## Pass 8 — 2026-08-16 (from code review, gateway defects)

Surfaced by the major-components code review (CODE_REVIEW.md), not the correctness-bug audit. Both in `demo_mcp_gateway`.

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 53 | High | 🟢 Fixed | DPoP + Web Bot Auth enforced on HTTP transport only — dodgeable by switching to WebSocket | `demo_mcp_gateway/src/index.ts` (WS handler) vs `middleware/authorizeMcpRequest.ts:717-830` |
| 54 | High | 🟢 Fixed | Dead `handleHttp` holds the only `POST /admin/clear-token-cache` impl — logout cache flush silently 404s, never runs | `demo_mcp_gateway/src/index.ts:181-323` vs `server/GatewayServer.ts` |

### 53. DPoP/WBA enforced HTTP-only, bypassable via WebSocket — High
DPoP (RFC 9449) proof verification, Web Bot Auth (`wbaMode=enforce`), and posture recording (`noteBindingHeaderSeen`) are implemented only in the HTTP path (`authorizeMcpRequest.ts:717-830`) — zero equivalent in the WS `handleMessage` handler in `index.ts`.
**Trigger:** with `REQUIRE_DPOP_PROOF=true` / `wbaMode=enforce`, a caller connects over WebSocket instead of HTTP and skips these checks entirely; `/health` posture is also blind to WS traffic. Same transport-bypass class as the already-fixed #13 (WS rate-limit bypass).
**Fix:** move the DPoP/WBA/posture checks into the shared pipeline (`auth/authorizeMcpRequestCore.ts` already proves the one-shared-core pattern) so both transports enforce them, or add the equivalent checks to the WS handler before dispatch.
**Fixed:** PR [#1875](https://github.com/curtismu7/AI-DEMO2/pull/1875) — verified real but narrower than the review claimed: RAR was NOT bypassed (already enforced via `guardToolCall`), only DPoP+WBA. Since both are HTTP-request-bound proofs a long-lived WebSocket can't carry, the fix **fails closed** — refuses WS `tools/call` when either control is enforced (steering to `POST /mcp`), via a new unit-tested `wsBindingGuard.ts`. No-op when controls are off. 68 scoped tests pass, tsc clean.

### 54. Dead `handleHttp` holds the only clear-token-cache route — logout flush never runs — High
`handleHttp` (`index.ts:181-323`) is dead code (the real listener is `GatewayServer.handleRequest`, confirmed by its own comment), but it contains the only implementation of `POST /admin/clear-token-cache`. `demo_api_server/server.js` still calls that endpoint on logout.
**Trigger:** user logs out → BFF POSTs `/admin/clear-token-cache` → `GatewayServer` never ported the route → silent 404 → the gateway's exchanged-token cache is never flushed, leaving a token-replay window open until natural TTL expiry.
**Fix:** port `POST /admin/clear-token-cache` (and check `/openapi/*` + reconcile the two drifting RFC 9728 metadata copies) into `GatewayServer`, then delete `handleHttp` and its duplicate `requireInternalSecret`.
**Fixed:** PR [#1876](https://github.com/curtismu7/AI-DEMO2/pull/1876) — verified real. Ported `POST /admin/clear-token-cache` (same `requireInternalSecret` gate) + `GET /openapi/*` into `GatewayServer`, flushing both the RFC 8693 exchange cache and RFC 7662 introspection cache; deleted dead `handleHttp` + duplicate helper + the drifting second RFC 9728 metadata copy. 20/20 tests (route now 200, was 404), tsc clean.

---

## Pass 9 — 2026-08-16 (fresh-territory sweep)

7 verified (refused to pad to 10 — codebase had 8 prior passes; hunters ruled out several hypotheses instead of inventing findings). Ruled-out negatives noted at the bottom.

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 55 | High | 🟢 Fixed | Delegated-commerce consent scope check filters to bare `read`/`write` — namespaced-scope tools get vacuously-true consent | `demo_api_server/services/delegatedCommerceRuntime.js:82-95` |
| 56 | High | 🟢 Fixed | Node gateway truncates multi-aud token to `aud[0]` — defeats the D-05 confused-deputy anti-bypass the Groovy path enforces (+ Rule 0b-2 comma-split parity nit) | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:160`, `pingAuthorizeGuard.ts:161`, `demo_authz_server/routes/decision.js:357` |
| 57 | Medium | 🟢 Fixed | Reverse tabnabbing — `window.open` on a server-supplied elicitation URL omits `noopener` | `demo_api_ui/src/components/ElicitationDialog.jsx:222` |
| 58 | Medium | 🟢 Fixed | Optional number field submits `NaN` → serialized as `null` to the BFF (client validation gap) | `demo_api_ui/src/components/ElicitationDialog.jsx:35-43,121` |
| 59 | Medium | 🟢 Fixed | mastra_agent never closes the open text bubble at a tool-call boundary — same class as #43 (openai), distinct instance | `mastra_agent/src/runHandler.ts:119-124` |
| 60 | Low | 🟢 Fixed | mastra_agent has no empty-messages fallback — empty/filtered `messages` calls `agent.stream([])` | `mastra_agent/src/runHandler.ts:89-94` |
| 61 | Low | 🟢 Fixed | Invest resource-server tool interpolates `period`/`limit` into the BFF query string unencoded/unvalidated | `demo_mcp_resource_server/src/tools/investToolHandler.ts:50-65` |

### 55. Delegated-commerce consent scope bypass — High
```js
const requiredScopes = scopeTopology.toolScopes(tool)
  .filter((scope) => scope === 'read' || scope === 'write');   // keeps only bare tokens
...
sufficient: registration.status === 'active' && !expired &&
  requiredScopes.every((scope) => consentScopes.includes(scope)),
```
`scope-topology.json` declares tool scopes as namespaced strings (`sensitive:read`, `airlines:write`, `transfer`). The filter keeps only literal `read`/`write`, so any tool lacking those bare tokens yields `requiredScopes = []` → `[].every()` is vacuously `true` → `sufficient:true` regardless of what the customer consented to. `evaluateMcpFirstToolGate` (`mcpToolAuthorizationService.js:947`) then never raises `delegated_consent_scope_denied`.
**Trigger:** customer consents to `['read']` only; the delegated agent calls `get_sensitive_account_details` (`["read","sensitive:read"]`→`["read"]`) or `create_wire_transfer` (`["read","transfer"]`→`["read"]`) and passes; vertical write tools with no secondary challenge (`redeem_miles`/`pay_airline_fee`, `["airlines:read","airlines:write"]`→`[]`) have this as their SOLE consent control and it's fully silent — a read-only-consented agent performs writes. (Banking `create_transfer`=`["write","transfer"]`→`["write"]` is correctly gated, which masked the bug.)
**Fix:** classify each namespaced scope into an access class (any `*:write`/`transfer` ⇒ needs write consent, any `sensitive:*` ⇒ elevated) before `every()`, or compare consent against the tool's FULL `requiredScopes`. Filtering must never turn "requires write" into "requires nothing."
**Fixed:** PR [#1882](https://github.com/curtismu7/AI-DEMO2/pull/1882) — classifies each namespaced scope into the customer's `read`/`write` consent vocabulary (any `*:write`/`write`/`transfer`/`sensitive:*` ⇒ write consent, unreachable by read-only). Read-only agents now denied on sensitive/wire/airline-write tools; banking gating unchanged. 40/40 tests across 8 suites.

### 56. Node gateway multi-aud truncation defeats D-05 anti-bypass — High
```ts
const tokenAud = Array.isArray(decoded.aud) ? (decoded.aud[0] ?? '') : (decoded.aud ?? '');
base.TokenAudActual = tokenAud;   // only the FIRST aud element
```
The Groovy gateway was deliberately fixed to send the FULL space-joined aud list (`p1az-decision.groovy:278-283`, comment cites "mock Rule 0b-2's D-05 anti-bypass splits this on whitespace, so a multi-aud confused-deputy token is still caught"). The Node gateway still sends only `aud[0]`.
**Trigger:** a confused-deputy token `aud=["...mcpgateway...","...banking-resource-server..."]` through the Node gateway → `TokenAudActual` = gateway URI only → Rule 0b passes, Rule 0b-2 sees no upstream → PERMIT. The identical token through the Groovy pinggateway → DENY `bypass_attempt`. The anti-bypass control is enforced on one transport, silently defeated on the other.
**Plus parity nit:** `decision.js:337` Rule 0b splits `TokenAudActual` on `/[\s,]+/` (comma-aware) but Rule 0b-2 (`:357`) splits on `/\s+/` only — a comma-joined multi-aud would pass Rule 0b yet collapse to one element in Rule 0b-2.
**Fix:** send the full aud (`Array.isArray(decoded.aud) ? decoded.aud.join(' ') : decoded.aud`) in both TS files, matching Groovy; and make Rule 0b-2 split on `/[\s,]+/` too.

### 57. Reverse tabnabbing on elicitation URL — Medium
```jsx
await onSubmit({ action: 'accept' });
window.open(url, '_blank', 'secure');   // 'secure' is not a real feature; no noopener
```
`url` comes straight from the MCP server's elicitation request. The features string omits `noopener`, so the opened page keeps a live `window.opener`.
**Trigger:** a hostile/compromised MCP server returns a url-mode elicitation to `attacker.example`; user clicks "Open in Browser"; the new tab does `window.opener.location = <phishing clone>`, navigating the banking-demo tab to credential harvesting.
**Fix:** `window.open(url, '_blank', 'noopener,noreferrer')`; drop the bogus `'secure'` token.

### 58. Optional number field → NaN → null to BFF — Medium
`parseFloat('')` on a cleared number input is `NaN`, stored in `formData[key]`. `validateForm` only checks presence of `required` keys, so a non-required number field holding `NaN` passes; `JSON.stringify(NaN)` → `null`, so the BFF receives `key:null` for a schema-declared number.
**Fix:** store the raw string or guard `Number.isNaN` and set an error; validate numeric type/range for all present fields, not just presence of required ones.

### 59. mastra text bubble not closed at tool-call boundary — Medium
```ts
} else if (part.type === 'tool-call') {
  await emitter.onToolStart(...);   // never closes the open text message
```
Both siblings close it (openai `run_handler.py:259`, langchain `message_processor.py:1240`); mastra only closes in its `tool-error` branch, not the success `tool-call` path. Same defect class as the fixed #43, distinct instance.
**Trigger:** model streams lead-in text then calls a tool → `TEXT_MESSAGE_START` with no matching `END` before `TOOL_CALL_START`; post-tool narration merges into the still-open bubble (every text msg reuses `messageId: this.runId`) → tool card renders interleaved inside an unterminated assistant message.
**Fix:** `if (streaming) { await emitter.onLlmEnd(); streaming = false; }` in the `tool-call` branch.
**Fixed:** PR [#1880](https://github.com/curtismu7/AI-DEMO2/pull/1880) (with #60). 6/6 tests, tsc clean.

### 60. mastra no empty-messages fallback — Low
`coreMessages` filters to string-content messages; if empty/all-filtered, `agent.stream([])` is called with no user turn (the openai sibling guards with `... or [{"role":"user","content":""}]`).
**Trigger:** malformed/empty `messages` in the `/run` payload → the AI SDK errors or yields an empty stream → generic run failure instead of graceful handling.
**Fix:** fall back to a single placeholder user message when `coreMessages.length === 0`.
**Fixed:** PR [#1880](https://github.com/curtismu7/AI-DEMO2/pull/1880) (with #59) — placeholder `{role:'user',content:''}` when empty, mirroring openai sibling.

### 61. Invest tool unencoded query params — Low
```ts
return callBff(`/api/investment/accounts/${encodeURIComponent(accountId)}/portfolio?period=${period}`, token);
return callBff(`.../transactions?limit=${limit}`, token);
```
`account_id` is encoded but `period`/`limit` are concatenated raw; `limit === 0` silently becomes `20` (`0 || 20`). Account stays path-bound/encoded (no pivot), target is the trusted BFF — validation/consistency gap, not an auth bypass.
**Fix:** `encodeURIComponent(String(period))`; validate `limit` as a bounded integer instead of `|| 20`.

### Ruled out in pass 9 (verified NOT bugs — don't re-chase)
- **Other-vertical IDOR** (healthcare/gov/manufacturing/retail/etc. resource-server tools): NOT an IDOR — unlike banking, those tables carry no owner/subject column; they're shared demo reference datasets. Airlines scopes correctly via `resolvePassenger(subject)`.
- **`p1az-decision.groovy` `_p1azTokenCache` unsynchronized writes** (flagged by the code review): verified BENIGN — each write assigns a whole new map (JVM reference assignment is atomic), so a reader never sees a torn `token`/`expiresAt` pair; worst case is a redundant token fetch, never a wrong decision.
- **X-Authz-Simulated / header-trust spoofing** in p1az-decision.groovy: correctly closed — `trustedCaller` requires a constant-time `MessageDigest.isEqual` match of `BFF_INTERNAL_SECRET`; simulated headers read only when trusted; untrusted falls through to the real backend (fails closed).

---

## Pass 10 — 2026-08-16 (Agent Gateway focus; MCP hold lifted)

14 verified gateway-path bugs (find + code review). 2 High. Full review observations in CODE_REVIEW.md's gateway section. The 4 previously-held MCP bugs (#56/#57/#58/#61) were fixed this pass too (PRs #1887/#1886/#1885).

| # | Sev | Status | Title | File:Line |
|---|-----|--------|-------|-----------|
| 62 | Medium | 🟢 Fixed | `applyJsonPatch` drops depth≥3 STATE_DELTA ops (and array-index inserts) — enforcement/authorize/token panels go stale | `demo_api_ui/src/hooks/useAgentRun.js:58-100` |
| 63 | Medium | 🟢 Fixed | Gateway-tester Chain tab marks a rate-limited/DENY call as green "OK" (predicate omits rateLimited/429/decision) | `demo_api_ui/src/components/AgentGatewayTester.jsx:585` |
| 64 | Medium | 🟢 Fixed | Streaming `TOOL_CALL_ARGS` parsed per-delta and replaced, not accumulated — args lost on fragmented streams | `demo_api_ui/src/hooks/useAgentState.js:195-206` |
| 65 | High | 🟢 Fixed | Empty `authorization_details: []` bypasses RAR intent-subset enforcement under `REQUIRE_RAR_INTENT` | `demo_mcp_gateway/src/rarEnforce.ts:47`, `middleware/authorizeMcpRequest.ts:864`, `pingAuthorizeGuard.ts:277-281` |
| 66 | Medium | 🟢 Fixed | WS transport never surfaces the step-up obligation — falls through to generic `insufficient_scope`, step-up flow dead on WS | `demo_mcp_gateway/src/index.ts:826-832`, `pingAuthorizeGuard.ts:442,455` |
| 67 | High | 🟢 Fixed | Gateway-unreachable fails OPEN — a down/slow gateway routes every agent tool call through unauthenticated local execution (all policy skipped) | `demo_api_server/services/mcpToolPipeline.js:1640-1698` |
| 68 | Medium | 🟢 Fixed | 403 `hitl_required` path drops `gwAuditTrail` — authorize evidence lost, ProofStrip shows "failed before authorize" on a gate that fired | `demo_api_server/services/mcpGatewayClient.js:618-635` |
| 69 | Low | 🟢 Fixed | Stray `console.log` reads `tool.name`/`mcpAccessToken?.scope` (both always undefined; `tool`/token are strings) on every tool call | `demo_api_server/services/mcpToolPipeline.js:480,490` |
| 70 | Medium | 🟢 Fixed | HTTP `inFlightCalls` registry is process-global keyed by bare JSON-RPC id — `notifications/cancelled {requestId:1}` aborts another caller's call | `demo_mcp_gateway/src/server/GatewayServer.ts:145,682,772` |
| 71 | Medium | 🟢 Fixed | Runtime rate-limit reconfig is a silent no-op — admin changes `rateLimitMaxRequests`/`WindowMs`, returns 200, live limiter keeps old thresholds until restart | `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:212-217` |
| 72 | Low-Med | 🟢 Fixed | HTTP `readBody` has no size cap (WS was hardened with `maxPayload` 1 MB, HTTP wasn't) — authenticated caller can stream arbitrarily large bodies into memory | `demo_mcp_gateway/src/server/GatewayServer.ts:997-1004` |
| 73 | Medium | 🟢 Fixed | IG `p1az-decision.groovy` never sends `ToolDestructive`/`ElicitationConfirmed` etc — elicitation confirmation gate silently skipped on the IG/mock-backend path | `ping-gateway/scripts/groovy/p1az-decision.groovy:795-854` |
| 74 | Medium | ⚪ Not a bug | `/mcp/brave` + `/mcp/weather` IG routes have no inbound auth (no rsFilter/introspection/p1az) — only a fail-open flag + content filter; unauth caller reaches upstream MCP | `ping-gateway/config/routes/00-mcp-brave.json`, `00-mcp-weather.json`, `tx-brave-scope.groovy:10-21` |
| 75 | Low | 🟢 Fixed | `delegation-validate.groovy` `.add`s identity headers instead of replacing — a pre-set `X-Delegation-User` survives, downstream `getFirst()` reads the forged value | `ping-gateway/scripts/groovy/delegation-validate.groovy:76-78` |

**Pass-10 fix status (as of session handoff 2026-08-16):**
- **#70, #72 → PR [#1890](https://github.com/curtismu7/AI-DEMO2/pull/1890)** (OPEN, awaiting merge — 3 new + 32 regression tests pass, tsc clean). ⚠️ PR [#1851](https://github.com/curtismu7/AI-DEMO2/pull/1851) is a PARALLEL/older fix of the same #70 cross-caller-cancellation bug from another session — reconcile (merge one, close the other) before merging both.
- **MERGED:** #62,#63,#64 (PR #1891), #70,#72 (PR #1890), #65,#66,#71 (PR #1892), #73,#75 (PR #1893). #74 verified **not a bug** (routes DO chain rsFilter — hunter premise was stale).
- **#67, #68, #69 (BFF fail-open + hitl-audit + console.log):** fixer still in flight at handoff — new agent: check `gh pr list` for a PR referencing `BUGS.md #67`; if absent, re-dispatch (detail below; #67 is the remaining High). **New agent: run `gh pr list --state open` and look for PRs referencing `BUGS.md #<n>`; merge any that landed, and re-dispatch fixers for any missing** (full file:line + fix direction for each is in the table above and the detail below). Batch as: {62,63,64} UI (3 files), {65,66,71} demo_mcp_gateway enforcement (shared files — one fixer), {67,68,69} demo_api_server mcpToolPipeline/mcpGatewayClient (one fixer), {73,74,75} ping-gateway Groovy (one fixer, no test infra — verify by review).

### 65. Empty `authorization_details: []` bypasses RAR intent-subset — High
`enforceRarSubset` early-returns `{ok:true}` when `details.length === 0`, and the required-intent guard treats `[]` as "present" (`if (!_rarDetails)` — `[]` is truthy → skipped). Since `_rarDetails` is populated only from the caller-supplied `X-TraT-Context` (the mode this runs in, `ALLOW_UNSIGNED_TRAT_CONTEXT=true`), an attacker sets `azd.authorization_details: []` and the amount/payee subset checks are entirely skipped — defeating the control's fail-closed intent, on both transports.
**Fix:** when `requireRarIntent`, treat `_rarDetails.length === 0` as missing → fail closed (or drop the `length===0` early-return so the no-matching-grant DENY fires).

### 67. Gateway-unreachable fails OPEN to local execution — High
When `useGateway` is true the BFF's own authorize gate is deliberately skipped (gateway is sole PDP), but `_normalizeGatewayNetworkError` turns a down gateway into an error whose message contains `ECONNREFUSED`/`timed out`, so `isConnErr` is true → the pipeline runs the tool via `callToolLocal`, bypassing the gateway, MCP server, and PingOne Authorize (group/tier/RAR/scope all skipped). Contradicts the hardening on the sibling no-bearer and exchange-failure paths in the same file (the latter made opt-in OFF via `ff_local_fallback_on_exchange_failure`).
**Trigger:** gateway container down/slow → every agent tool call (transfers, cross-owner reads) executes locally with zero policy enforcement.
**Fix:** when `useGateway`, don't local-fall-back on gateway transport errors — return `GATEWAY_UNREACHABLE`/`GATEWAY_TIMEOUT` (503/504), or gate behind the same `ff_local_fallback_on_exchange_failure` opt-in with a `_degraded` marker.

*(Entries #62-64, #66, #68-75: see the per-hunter detail captured in the pass-10 review; each has file:line, snippet, trigger, and fix direction. Summarized in the table above; expanded on fix.)*

### Gateway review observations (not bugs — recorded for CODE_REVIEW.md)
- **HTTP/WS enforcement is hand-mirrored** (scope backstop, tier, RAR, obligation→response) across `authorizeMcpRequest.ts` and `guardToolCall`/`index.ts` — bugs #66 and the aud-truncation (#56) are this drift class. Recommend one shared decision→transport-neutral outcome mapper + a parity test asserting identical error taxonomy per obligation.
- **Intent-token `permitted_tools` not locally enforced** (`intentTokenValidator.ts:99`) — only the PDP checks it; in local-fallback mode an intent token for tool A is accepted for tool B.
- **Delegated-consent revocation may be bypassed in gateway mode** — `evaluateMcpFirstToolGate` (the only place `resolveConsentContext` runs) is skipped when `useGateway`; confirm the gateway independently enforces delegated-commerce consent/revocation.
- **RFC 8693 subject-swap only warns** (`agentMcpTokenService.js:1636`) — `exchanged.sub !== userSub` pushes a warning but forwards the token; should fail closed.
- **IG↔Node parity by prose, no golden-payload test**; `p1az-decision.groovy` is 65KB untested; `HttpURLConnection` helpers copy-pasted across 4 Groovy scripts; `invest-dispatch.groovy` collapses backend status to 200 (opposite of `olb-token-exchange.groovy`'s deliberate preservation).
- **Mermaid `securityLevel:'loose'` + editable source + `innerHTML`** on the diagram pages; **brittle single-line `data:` SSE parse** (`useAgentRun.js:42`); **`CopyButton` setTimeout no cleanup**.

---

## How to rerun

Ask: "audit the project for bugs, update BUGS.md" — new pass gets appended as `## Pass N — <date>`, existing entries get status updated in place (do not duplicate a still-open bug into a new pass table).
