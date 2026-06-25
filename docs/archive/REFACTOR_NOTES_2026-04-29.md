# Refactor Notes — 2026-04-29

**Author:** Claude (paired with Curtis)
**Scope:** UI logging cleanup in `banking_api_ui/src/services/bankingAgentService.js`
**Motivation:** `PHASE_84_CODE_QUALITY_AUDIT.md` flagged `bankingAgentService.js`
as a hotspot with ~13 raw `console.*` calls and noted UI service files as a
medium-priority logging cleanup target.

---

## Summary

A purely behavior-preserving refactor. No function signatures, exports, return
shapes, error codes, or HTTP/SSE flows were changed. Only logging style and a
small bit of duplicated error-handling code were touched.

## Files changed

### 1. Added — `banking_api_ui/src/services/logger.js` (new)

A tiny named-logger factory.

```js
import { createLogger } from './logger';
const log = createLogger('callMcpTool');
log.debug('starting', { tool });   // [callMcpTool] starting { ... }
log.warn('slow response');
log.error('failed', err);
```

Behavior:

- Levels: `debug < info < warn < error`.
- In production (`process.env.NODE_ENV === 'production'`) only `warn` and
  `error` pass through — keeps the browser console quiet for end users.
- In dev, all levels are emitted.
- Escape hatch for live debugging in prod: set `window.__BANKING_DEBUG__ = true`
  in the browser DevTools console and `debug` / `info` will start flowing.
- Every line is prefixed with `[name]` (the namespace passed to `createLogger`).

### 2. Refactored — `banking_api_ui/src/services/bankingAgentService.js`

Two changes:

**a) Replaced all raw `console.*` calls with the new logger.**

13 call sites, e.g.:

```diff
- console.log('[callMcpTool] === MCP TOOL CALL START ===');
- console.log('[callMcpTool] tool:', tool);
- console.log('[callMcpTool] params:', JSON.stringify(params));
- console.log('[callMcpTool] tool type:', typeof tool);
+ log.debug('=== MCP TOOL CALL START ===', { tool, toolType: typeof tool, params });
```

```diff
- console.error('[callMcpTool] 400 error from server:', { ... });
+ log.error('400 error from server', { ... });
```

```diff
- console.warn("[parseStreamingResponse] No result object received for", tool);
+ streamLog.warn('No result object received for', tool);
```

**b) Extracted a duplicated error-handling block into a helper.**

The same "is this an `AbortError` / `Failed to fetch` / `ERR_CONNECTION` ?"
block was inlined three times (in the flow-diagram `try`, the SSE handler, and
the body-construction `try`), each throwing the same normalized 504. It's now
a single helper at the top of the file:

```js
function throwIfNetworkError(err, contextMsg) {
  const isNetwork =
    err.name === 'AbortError' ||
    err.message === 'Failed to fetch' ||
    (typeof err.message === 'string' && err.message.includes('ERR_CONNECTION'));
  if (!isNetwork) return false;
  log.error(`${contextMsg}: connection timeout or network error`, {
    errorName: err.name,
    errorMessage: err.message,
  });
  throw Object.assign(new Error('Connection timeout - server may be restarting'), {
    statusCode: 504,
    code: 'connection_timeout',
    isNetworkError: true,
  });
}
```

Each of the three call sites is now a one-liner:

```js
} catch (err) {
  throwIfNetworkError(err, 'flow diagram start');
  // non-network errors here are non-fatal — log and continue
  log.warn('Flow diagram initialization failed', err);
}
```

## What did NOT change

- All 12 `export`s preserved: `refreshOAuthSession`, `callMcpTool`,
  `getMyAccounts`, `getAccountBalance`, `getMyTransactions`, `createTransfer`,
  `createDeposit`, `createWithdrawal`, `createTransferWithConsent`,
  `createDepositWithConsent`, `createWithdrawalWithConsent`, `sendAgentMessage`.
- Return shape `{ result, tokenEvents }` unchanged.
- Thrown error shapes unchanged. Codes consumers branch on
  (`missing_exchange_scopes`, `mcp_scope_denied`, `session_not_hydrated`,
  `connection_timeout`, `server_unavailable`) all still emitted with the same
  `statusCode`, `code`, and metadata fields.
- 401-refresh retry logic, streaming-response parser, 400 / 504 / scope-denied
  paths, and HITL consent helpers all untouched.

## Verification performed

1. Parsed both files with `acorn` (ES module mode) — both clean.
2. `grep -n 'console\.'` on the refactored file → zero matches.
3. Confirmed all 9 imports used by `components/BankingAgent.js`
   (`callMcpTool, createDeposit, createTransfer, createWithdrawal,
   getAccountBalance, getMyAccounts, getMyTransactions, refreshOAuthSession,
   sendAgentMessage`) are still exported.
4. Searched the codebase for the error codes the file throws — none of those
   throw sites were modified, so consumer branching is unaffected.

## Recommended next step before merging

Per `CLAUDE.md` § Quick verification checklist, run:

```bash
cd banking_api_ui
npm run build     # exit code must be 0
```

If the team wants this logger pattern adopted more broadly, the next obvious
candidates from the Phase 84 audit (descending console-statement count) are:

- `services/bankingRestartNotificationService.js` (9)
- `services/apiClient.js` (9)
- `components/ErrorBoundary.js` (8)
- `components/UserDashboard.js` (8)
