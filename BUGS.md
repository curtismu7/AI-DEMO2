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
| 1 | Critical | 🔴 Open | TOCTOU overdraft race in agent transfers/withdrawals | `demo_api_server/services/mcpLocalTools.js:401-408`, `:339-345` |
| 2 | High | 🔴 Open | Agent-restriction gate trusts unauthenticated header | `demo_api_server/middleware/agentRestrictionsGate.js:110-111` |
| 3 | High | 🔴 Open | Cross-caller tool-list leak via unkeyed global cache | `demo_mcp_proxy/server.js:14,108-120` |
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

### 2. Agent-restriction gate trusts unauthenticated header — High
Mounted on `/api/accounts` and `/api/transactions` **before** `authenticateToken` (`server.js:1303-1304`):
```js
const agentSub = req.headers['x-agent-sub'];
if (!agentSub) return next();
```
Every other failure mode in this file is fail-closed (worker-token fetch fails → restrict, PingOne lookup errors → restrict, exception → restrict) except the entry condition itself, which trusts a raw client-supplied header never cross-checked against the verified token's RFC 8693 `act` claim (`req.user.actor`).
**Trigger:** a request that simply omits `X-Agent-Sub` skips the entire restriction-tier check — a "restricted" agent gets full write access.
**Fix:** derive agent-originated status from the verified token's `act` claim post-auth, not a pre-auth header.

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

## How to rerun

Ask: "audit the project for bugs, update BUGS.md" — new pass gets appended as `## Pass N — <date>`, existing entries get status updated in place (do not duplicate a still-open bug into a new pass table).
