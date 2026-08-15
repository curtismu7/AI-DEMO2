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
| 11 | Critical | 🔴 Open | Tool-call name/args/id discarded on every real tool call (openai_agent) | `openai_agent/src/run_handler.py:234-240` |
| 12 | High | 🔴 Open | `/api/admin/scope-audit` missing `requireAdmin` — any logged-in user can read/write PingOne scopes | `demo_api_server/routes/scopeAudit.js:42,118` |
| 13 | High | 🔴 Open | UC18 rate limiting enforced on HTTP only — WebSocket transport (primary ingress) bypasses it entirely | `demo_mcp_gateway/src/index.ts` (WS `tools/call`) vs `middleware/authorizeMcpRequest.ts:249-308` |
| 14 | High | 🔴 Open | `tool-error` stream chunk unhandled — UI hangs, run reports false success after a failed tool call | `mastra_agent/src/runHandler.ts:111-141` |
| 15 | High | 🔴 Open | JWT decode crashes on base64url `-`/`_` chars — silently hides decoded-token panel for real tokens | `demo_api_ui/src/services/tokenInspector.js:17-26` |

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

### 12. `/api/admin/scope-audit` missing `requireAdmin` — High
```js
app.use('/api/admin/scope-audit', authenticateToken, require('./routes/scopeAudit'));
// router.get('/resources', ...) and router.post('/scopes', ...) — neither gated by requireAdmin
```
Every other `/api/admin/*` route pairs `authenticateToken` with `requireAdmin` (confirmed in `admin.js`, `adminAgentTools.js`, `groupMembership.js`). This route is the outlier.
**Trigger:** any logged-in customer (not just an admin) can call `GET /api/admin/scope-audit/resources` (dumps every PingOne resource server + scopes via the Management API worker token) and `POST /api/admin/scope-audit/scopes` (creates a new OAuth scope on any PingOne resource — a live tenant write).
**Fix:** add `requireAdmin` at the mount point or per-route, matching the pattern used everywhere else under `/api/admin`.

### 13. UC18 rate limiting bypassed entirely over WebSocket — High
The HTTP middleware's `tools/call` path checks `config.rateLimitEnabled` and calls the `SlidingWindowLimiter`, returning 429 on burst. The WS `tools/call` handler in `index.ts` (the gateway's documented primary ingress — "Accepts JSON-RPC over WebSocket from agent") runs straight from token validation into tool dispatch with zero rate-limit references anywhere in the file.
**Trigger:** an agent connects over WebSocket and sends `tools/call` bursts. The same calls over HTTP get throttled at `GATEWAY_RATE_LIMIT_MAX_REQUESTS`; over WS they're never throttled — full UC18 resource-exhaustion/cost-runaway protection is void for the primary channel.
**Fix:** add the same `SlidingWindowLimiter` check (keyed `sub:toolName`) to the WS `tools/call` branch, before `guardToolCall`.

### 14. `tool-error` stream chunk unhandled in mastra_agent — High
`runHandler.ts`'s `fullStream` switch only handles `'text-delta' | 'tool-call' | 'tool-result' | 'error'`. A failed tool `execute()` (BFF timeout/non-2xx/abort) emits a distinct `'tool-error'` chunk per the underlying `ai` SDK — never `'tool-result'` — which this switch silently drops.
**Trigger:** a BFF tool call fails mid-run. `onToolStart` already set `anyVisibleOutput = true`; the dropped `tool-error` chunk means `onToolEnd` never fires for that call, so the UI entry (`useAgentState.js`) hangs at `status: 'running'` forever, AND `onRunEnd()` still emits `RUN_FINISHED` (not an error) since `anyVisibleOutput` is already true — a failed tool call (potentially a transfer) is reported as a successful run.
**Fix:** add an `else if (part.type === 'tool-error')` branch that calls `emitter.onToolEnd()` with an error so the UI entry resolves instead of hanging.

### 15. JWT decode crashes on base64url characters — High
```js
header: JSON.parse(atob(parts[0])),
payload: JSON.parse(atob(parts[1])),
```
`atob()` only accepts standard base64 (`+`/`/`); JWTs use base64url (`-`/`_`). Verified directly: `atob('YWJjZGVmZ2hpams-_')` throws `Invalid character`.
**Trigger:** any real PingOne-issued token whose header/payload segment contains `-` or `_` (near-certain at typical token length) throws inside `decodeJWT`'s try block, returning `{isValid:false}` for a perfectly valid token — silently hiding the decoded-token panel in Protocol Playground's `TokenInspector.jsx` and `ExecutionEngine.executeStep`. The existing test suite only uses a hand-crafted token that happens to avoid `-`/`_`, masking the bug. Same pattern also exists in `Dashboard.js`, `UserDashboard.js`, `UserDashboardPing2026.js`, `TokenInspectModal.jsx`, `TokenExchangePanel.js` (flagged for awareness, not filed separately).
**Fix:** replace `-`/`_` with `+`/`/` (and pad) before calling `atob`, or use a base64url-safe decode helper.

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
| 16 | Medium | 🔴 Open | `fetchLiveAccounts` has no staleness guard — rapid vertical-switching can apply an older vertical's accounts last | `demo_api_ui/src/components/AIAgent.js:1856-1911` |
| 17 | Medium | 🔴 Open | Stale OAuth/HITL challenge has no expiry check, hijacks every subsequent reply in a session | `langchain_agent/src/agent/langchain_mcp_agent.py:1109-1149` |
| 18 | Medium | 🔴 Open | Admin-editable `hitlThresholdUsd` persisted and shown live-overridden but never actually read by the PDP | `demo_authz_server/ruleStore.js:66-68` |
| 19 | Medium | 🔴 Open | Server-side relative `fetch()` throws immediately — every RFC 9728 compliance audit reports false-negative | `demo_api_server/services/rfc9728ComplianceAuditService.js:366,405,462,500,704` |
| 20 | Medium | 🔴 Open | StepCard "Execute" enabled-check reads the wrong step's completion — per-step buttons past step 1 permanently disabled | `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx:106-119` |
| 21 | Medium | 🔴 Open | `/health` posture check inspects only the legacy singular actor-client field, false-positive "fail open" report | `demo_mcp_gateway/src/authzPosture.ts:108` |
| 22 | Medium | 🔴 Open | Auth-bypass dev-mode warning uses raw `console.warn` instead of `teachLog`, skips correlation-id logging | `demo_hitl_service/src/routes/challenges.js:30` |
| 23 | Medium | 🔴 Open | `respondedBy` documented and store-supported but never captured on HITL approval | `demo_hitl_service/src/routes/challenges.js:127-139` |

---

## Pass 4 — 2026-08-15 (UI-focused)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 24 | High | 🔴 Open | atob() crashes on base64url JWT payloads in Token Exchange Inspector modal | `demo_api_ui/src/components/TokenInspectModal.jsx:5-14` |
| 25 | High | 🔴 Open | Same atob() crash — decoded-token section silently vanishes in Learning Hub | `demo_api_ui/src/components/education/TokenExchangePanel.js:251` |
| 26 | High | 🔴 Open | `useNewItems` stops detecting new items after any array reset (e.g. new agent run) | `demo_api_ui/src/hooks/useNewItems.js:14-26` |
| 27 | Medium | 🔴 Open | `useAgentCCTokenPrefetch` re-fetches every poll/SSE tick instead of once on mount | `demo_api_ui/src/hooks/useAgentCCTokenPrefetch.js:15,69` |
| 28 | Medium | 🔴 Open | Dead `tokenData` state — decoded token discarded, wasted fetch/decode work, live landmine | `demo_api_ui/src/components/Dashboard.js:72,417-451` |

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

### 27. `useAgentCCTokenPrefetch` re-fetches on every poll/SSE tick — Medium
Effect depends on `[tokenChain]`, but `tokenChain` (from `TokenChainContext`'s `useMemo`) gets a new identity on nearly every provider state change (15s poll, SSE events, history writes). The duplicate-prevention check runs only after fetch completes, not before.
**Trigger:** on any token-chain route, each poll/SSE tick re-renders the provider, giving `tokenChain` a new reference, re-running the effect and firing another `GET /api/tokens/agent-cc-preview` — indefinitely, contradicting the hook's own doc comment ("prefetch ... once on component mount").
**Fix:** depend on a stable reference (e.g. `tokenChain?.setTokenEvents`) instead of the whole context object, matching the pattern already used in `useCurrentUserTokenEvent.js`.

### 28. Dead `tokenData` state in Dashboard.js — Medium
```js
const [, setTokenData] = useState(null);   // value discarded!
...
setTokenData({ accessToken: decodeToken(response.data.accessToken), ... });
```
`tokenData` (the state value) is destructured away — only the setter kept — and never read anywhere else in the file. `fetchTokenData()` still does a real network round-trip and JWT decode on every dashboard mount and every token-modal open, thrown into the void; the modal actually shown fetches its own data independently.
**Trigger:** no current visible break (output is discarded), but wasted API calls + decode work on every mount, and the same unconverted-base64url `atob` bug exists here too — currently harmless only because its output is discarded; becomes a live landmine the moment someone wires `tokenData` back into the render (e.g. "fixing" the unused-state lint warning).
**Fix:** either delete the dead `fetchTokenData`/`decodeToken`/`setTokenData` plumbing, or wire `tokenData` into the modal it was clearly meant to feed.

---

## Pass 5 — 2026-08-15 (BFF-focused, demo_api_server)

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 29 | Critical | 🔴 Open | `/api/self-service/users` POST has no admin check — any customer can self-grant `role: "admin"` | `demo_api_server/routes/selfServiceUsers.js:90-175` |
| 30 | Critical | 🔴 Open | A2A auth accepts unsigned/forged JWTs — sole gate never verifies signature | `demo_api_server/middleware/a2aPingOneBearer.js:24-26` |
| 31 | Critical | 🔴 Open | JWT algorithm confusion — verification `alg` read from attacker-controlled header (RS256→HS256 forgery) | `demo_api_server/services/tokenValidationService.js:139-141` |
| 32 | High | 🔴 Open | Plaintext passwords written to activity log — `Authorization` header redacted but request body isn't | `demo_api_server/middleware/activityLogger.js:112` |
| 33 | High | 🔴 Open | RFC 8707 resource-format validator regex rejects every resource the service itself defines | `demo_api_server/services/resourceIndicatorService.js:100-107` |

### 29. `/api/self-service/users` missing admin gate — Critical
```js
app.use('/api/self-service/users', authenticateToken, selfServiceUsersRoutes);
// POST handler accepts `role` from body, validated only as isIn(['customer','admin']) — no req.user.role check
```
Sibling handlers in the same file (`DELETE /:userId`, `GET /`) both explicitly gate on `req.user.role !== 'admin'`. The `POST /` handler doesn't, and forwards `role` straight into `pingOneUserService.createPingOneUser(...)` + `ensureAdminRoleAssignments(user.id)`.
**Trigger:** any logged-in customer POSTs `{email, username, ..., role: "admin"}` → gets back a new PingOne user with admin role assignments granted, no admin session involved.
**Fix:** add the same `req.user.role !== 'admin'` gate used by the sibling DELETE/GET handlers, or drop `role`/`ensureAdminRoleAssignments` from the self-service path entirely.

### 30. A2A auth accepts unsigned/forged JWTs — Critical
```js
const decoded = decodeJwt(token);   // base64-decodes header+payload, NEVER checks signature
const clientId = claims.client_id || claims.cid || claims.sub || null;
req.a2aPingOne = { token, claims, clientId: String(clientId) };
```
This is the sole auth gate on the live A2A JSON-RPC route (mounted without session `authenticateToken`). `decodeJwt` never verifies against PingOne's JWKS, unlike `middleware/auth.js`'s `authenticateToken`.
**Trigger:** anyone crafts `header.payload.signature` with an arbitrary `client_id`/`sub` in the payload (signature bytes can be garbage), POSTs it as `Authorization: Bearer <forged>` → marked `isAuthenticated: true` under that identity. Full identity spoofing on A2A specialist endpoints.
**Fix:** verify the JWT signature/issuer (JWKS or PingOne introspection) before trusting any claim, matching `authenticateToken`'s pattern.

### 31. JWT algorithm confusion (RS256→HS256 forgery) — Critical
```js
const { kid, alg } = decoded.header;   // UNVERIFIED header the caller sent
const verifyOptions = { algorithms: [alg || 'RS256'] };
```
Classic CWE-347: the verification algorithm allow-list is derived from attacker-controlled token content instead of being server-fixed. Backs `validatePingOneCoreToken` in JWT-signature-verification mode (an alt to introspection mode).
**Trigger:** attacker knows a valid `kid` (public via JWKS by design), crafts a token `{alg:"HS256", kid:"<real-kid>"}`, HMAC-signs it using the RSA public key's PEM string (also public) as the HMAC secret. `algorithms` becomes `['HS256']` from the forged header, and the "key" passed to `jwt.verify` is that same PEM — `jsonwebtoken` HMAC-verifies successfully. Full auth bypass with a self-forged token for any subject/claims.
**Fix:** hard-code `algorithms: ['RS256']` (or an explicit server-controlled allow-list of asymmetric algorithms only) — never read `alg` from the token header.

### 32. Plaintext passwords in activity log — High
```js
requestBody: method === 'POST' || method === 'PUT' ? req.body : null,
```
Globally mounted. `Authorization` header is explicitly redacted two lines above — showing password exposure wasn't intended — but the request body isn't.
**Trigger:** user logs in / registers / changes password → activity log entry persists the plaintext password field, later viewable via the admin activity-log surface.
**Fix:** redact known sensitive fields (`password`, `newPassword`, etc.) from `requestBody` before storing, same treatment as the auth header.

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

### Also found in pass 5, not in top 5 (verified, logged for awareness)
- `demo_api_server/routes/complianceAgentRoutes.js:16-42`, `routes/supportAgentRoutes.js:16-45` — identity taken from `req.body.userId` instead of the authenticated `req.agentContext.userId`; an authenticated user can act under a spoofed identity on the compliance/support agent init/message endpoints (Medium).
- `demo_api_server/routes/investment.js:16-28` — `accountId` path param is echoed back unvalidated; `GET /accounts/:accountId/portfolio` returns the caller's real portfolio mislabeled under whatever `accountId` was requested (Low/Medium).
- `demo_api_server/middleware/tokenErrorMiddleware.js:43-46` — operator-precedence bug misclassifies token type (`||`/`&&` bind tighter than `?:`); currently unmounted/unexploitable but would defeat a `system`-only gate if wired into a route (Medium).

---

## How to rerun

Ask: "audit the project for bugs, update BUGS.md" — new pass gets appended as `## Pass N — <date>`, existing entries get status updated in place (do not duplicate a still-open bug into a new pass table).
