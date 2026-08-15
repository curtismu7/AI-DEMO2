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
| 4 | Medium | 🔴 Open | Admin "$0 transaction limit" silently ignored (`\|\|` vs finite-check) | `demo_api_server/routes/transactions.js:476` vs `demo_api_server/routes/admin.js:540-543` |
| 5 | Medium | 🔴 Open | UC18 rate limiter race — Groovy port not thread-safe | `ping-gateway/scripts/groovy/uc18-rate-limit.groovy:101-127` |

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

---

## Pass 2 — 2026-08-15

| # | Severity | Status | Title | File:Line |
|---|----------|--------|-------|-----------|
| 6 | High | 🟢 Fixed | RAR grant-match falls back to wrong grant on spec-shaped `authorization_details` | `demo_mcp_gateway/src/rarEnforce.ts:50-55` |
| 7 | High | 🟢 Fixed | Non-numeric `TransactionAmount` silently becomes 0, bypasses all dollar-based PDP gates | `demo_authz_server/routes/decision.js:779,806,849,874-875` |
| 8 | High | 🟢 Fixed | Dead AG-UI tool-call hooks report "run failed" after a transfer already executed | `pydantic_agent/src/agui_emitter.py:18,35-41,52-59` |
| 9 | High | 🟢 Fixed | XSS via unescaped `dangerouslySetInnerHTML` in JSON viewer | `demo_api_ui/src/components/ProtocolPlayground/JSONViewer.jsx:11-36` |
| 10 | Medium | 🔴 Open | Admin audit logger arg-shape mismatch drops all audit event data | `demo_api_server/services/adminAuditService.js:26-186` vs `exchangeAuditStore.js:15-22` |

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

### Also found in pass 2, not in top 5 (verified, logged for awareness — not yet tracked with a number)
- `demo_api_ui/src/components/AIAgent.js:1856-1911` — no staleness guard on `fetchLiveAccounts`; rapid vertical-switching can apply an older vertical's accounts last (Medium).
- `langchain_agent/src/agent/langchain_mcp_agent.py:1109-1149` — stale OAuth/HITL challenge has no expiry check, hijacks every subsequent reply in a session until the user completes that exact flow (Medium).
- `demo_authz_server/ruleStore.js:66-68` — admin-editable `hitlThresholdUsd` is persisted and shown as live-overridden but `decision.js` Rule 4 actually reads separate env vars; the control is dead (Medium).

---

## How to rerun

Ask: "audit the project for bugs, update BUGS.md" — new pass gets appended as `## Pass N — <date>`, existing entries get status updated in place (do not duplicate a still-open bug into a new pass table).
