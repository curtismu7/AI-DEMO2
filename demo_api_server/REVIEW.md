# Banking API Server — Code Review Report

**Date:** 2026-04-26
**Phase:** 236 — Async Patterns, Memory Leaks, Security, Modern JS Standards, Maintainability
**Scope:** Selected files from `banking_api_server/services/`, `banking_api_server/routes/`, `banking_api_server/middleware/`
**Reviewer:** Claude (automated static analysis pass)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| Major | 22 |
| Minor | 37 |
| **Total** | **62** |

**Top 3 recommended immediate actions:**

1. **`agentTokenService.js:41-79`** — `validateAgentActorToken()` is a security stub that always returns `{ valid: true }` regardless of input. Any gate relying on this function is completely bypassed. This is an active production security hole.
2. **`middleware/tokenIntrospection.js:24`** — Cache key is `token.substring(0, 20)`. Two tokens sharing a 20-char prefix collide to the same cache slot, potentially returning another user's introspection result — a session boundary failure.
3. **`transactions.js:343`** — Balance check compares against the stale destructured `amount` string binding rather than the validated numeric `parsedAmount`. Non-numeric input that passed upstream checks could produce `NaN < balance === false`, silently allowing a fraudulent transaction.

---

## All Findings (Sorted by Severity)

| # | Severity | Category | File:Line | Issue | Fix Snippet |
|---|----------|----------|-----------|-------|-------------|
| 1 | Critical | Security | `agentTokenService.js:41-79` | `validateAgentActorToken()` stub always returns `{ valid: true, actorId: 'placeholder-actor-id', scopes: [...] }` regardless of input. Any gate calling this is fully bypassed. | `// SECURITY STUB — DO NOT USE IN PRODUCTION` banner + implement real validation via introspection service, or remove all callers. |
| 2 | Critical | Security | `middleware/tokenIntrospection.js:24` | Cache key is `token.substring(0, 20)` — first 20 chars of raw bearer token. Two tokens sharing a 20-char prefix collide on the same cache entry, returning another user's introspection result. | `const cacheKey = require('crypto').createHash('sha256').update(token).digest('hex');` |
| 3 | Critical | Security | `routes/transactions.js:343` | `fromAccount.balance < amount` compares numeric balance against the original destructured `amount` binding (a string from `req.body`). The validated numeric value is `parsedAmount`. JS coercion hides the bug but `NaN < balance === false` silently allows invalid transactions. | `if (fromAccount.balance < parsedAmount) { return res.status(400).json({ error: 'insufficient_funds' }); }` |
| 4 | Major | Async | `server.js:980` | `POST /api/mcp/tool` (~555-line async handler) has no outer try/catch. Lines 983–1080 run before any `try` block. A synchronous throw produces an unhandled promise rejection in Express 4. | `async (req, res, next) => { try { /* entire handler */ } catch (err) { next(err); } }` |
| 5 | Major | Async | `server.js:466-470` | `oauthService.revokeToken()` called twice in `GET /api/auth/logout` without `await` and without `.catch()`. Promise rejections are silently swallowed. | `oauthService.revokeToken(token).catch(err => console.warn('[logout] revoke error:', err.message));` |
| 6 | Major | Async | `routes/transactions.js:152-173` | `POST /consent-challenge` async handler: `restoreAccountsFromSnapshot()` is awaited with no outer try/catch. Rejection propagates unhandled in Express 4. | `async (req, res, next) => { try { /* body */ } catch (err) { next(err); } }` |
| 7 | Major | Async | `routes/transactions.js:176-192` | `POST /consent-challenge/:challengeId/confirm` async handler: `txConsent.confirmChallenge()` awaited with no outer try/catch. | Same fix as #6. |
| 8 | Major | Async | `delegationService.js:157` | `fetchPingOneUserByUsername(delegateEmail).catch(() => ({ user: null }))` swallows ALL errors including network failures and 500s. A PingOne outage causes silent fallthrough to user provisioning, potentially creating duplicates. | `catch(err => { if (err.response?.status === 404) return { user: null }; throw err; })` |
| 9 | Major | Async | `delegationService.js:117-233` | `grantDelegation` body has no top-level try/catch. If `getStorage()` or `storage.db.prepare()` throws, an unformatted error surfaces instead of the expected `{ ok: false, error, message }` return shape. | `try { /* body */ } catch (err) { return { ok: false, error: 'internal_error', message: err.message }; }` |
| 10 | Major | Async | `cibaService.js:103-109` | `initiateBackchannelAuth` calls `axios.post` with no try/catch. Non-2xx PingOne responses propagate as raw axios errors without the error-enrichment pattern used in every other service method. | `try { const r = await axios.post(…); return r.data; } catch (err) { throw enrichAxiosError(err, 'ciba/initiate'); }` |
| 11 | Major | Async | `cibaService.js:135-143` | `pollForTokens` calls `axios.post` with no try/catch. Callers who do not catch receive an unformatted axios error. | Document in JSDoc that callers must catch, or add internal error enrichment matching other service methods. |
| 12 | Major | Async | `agentMcpTokenService.js:461-513` | `performDualModeTokenExchange` calls `exchangeTokenRfc8693` which catches errors internally and returns `null`. The outer try/catch never fires for RFC 8693 failures; `err.tokenEvents` is never attached; callers get `null` with zero diagnostic context. | In `exchangeTokenRfc8693`, rethrow enriched errors rather than returning `null`. |
| 13 | Major | Async | `agentMcpTokenService.js:~822,1120,1195,1364,1481,1505` | Multiple `void writeExchangeEvent(...)` fire-and-forget calls. If `writeExchangeEvent` throws synchronously before returning a promise, the error is silently lost. | `writeExchangeEvent({...}).catch(err => console.warn('[audit]', err.message));` |
| 14 | Major | Async | `pingOneAuthorizeService.js:106-141` | `getWorkerToken()` fetches a fresh client-credentials token on every call. All four major methods call it independently. For frequent MCP tool evaluations this doubles PingOne API round-trips and risks rate limiting. | Cache token in module-level variable: `if (Date.now() < _tokenExpiresAt - 30000) return _cachedToken;` |
| 15 | Major | Async | `oauthService.js:197,784` | `require('jsonwebtoken')` called inline inside two hot async methods (`exchangeCodeForToken`, `refreshAccessToken`). Dynamic `require` inside hot paths adds unnecessary module-lookup overhead on every invocation. | Hoist to module top-level: `const jwt = require('jsonwebtoken');` |
| 16 | Major | Memory | `server.js:889` | `oauthMonitor.startPeriodicHealthCheck()` calls `setInterval()` but the return handle is never stored. No SIGTERM/SIGINT handler clears this interval. Timer leaks on graceful shutdown. | `this._intervalId = setInterval(…); stop() { clearInterval(this._intervalId); }` — call `oauthMonitor.stop()` in SIGTERM handler. |
| 17 | Major | Memory | `server.js` (whole file) | No SIGTERM/graceful shutdown handler. HTTP server handle returned by `app.listen()` is never stored; `server.close()` is never called on termination. In-flight requests are cut abruptly. | `const server = app.listen(…); process.on('SIGTERM', () => { server.close(); oauthMonitor.stop(); });` |
| 18 | Major | Memory | `server.js` (whole file) | No `unhandledRejection` or `uncaughtException` handler registered. In Express 4, async handlers that throw without try/catch leave dangling promises; Node v15+ crashes with no structured log. | `process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); process.exit(1); });` |
| 19 | Major | Memory | `services/tokenIntrospectionService.js:108` | `introspectionCache` Map grows unbounded. Expired entries are never pruned — `getCacheStats()` reads stale counts but nothing calls `introspectionCache.delete()`. The middleware's cache prunes at size >1000; this service's cache has no pruning at all. | After each `introspectionCache.set(...)`: `for (const [k,v] of introspectionCache) { if (Date.now() >= v.expiresAt) introspectionCache.delete(k); }` |
| 20 | Major | Security | `configStore.js:185` | `_getEncryptionKey()` silently falls back to `'dev-fallback-key-do-not-use-in-production'` when neither `CONFIG_ENCRYPTION_KEY` nor `SESSION_SECRET` is set. In production all SQLite secrets are encrypted with a well-known public key — effectively plaintext. No runtime warning is emitted. | `if (!process.env.CONFIG_ENCRYPTION_KEY && !process.env.SESSION_SECRET) { console.error('[ConfigStore] CRITICAL: Using hardcoded dev encryption key'); }` |
| 21 | Major | Security | `configStore.js:212-216` | `_decrypt()` catches all errors and silently returns `''`. If the encryption key rotates, all secrets silently become empty strings; operators see confusing "not configured" errors rather than a key-mismatch warning. | `console.warn('[ConfigStore] Could not decrypt', row.key, '— re-enter the credential');` per-key when decryption returns empty. |
| 22 | Major | Security | `simulatedAuthorizeService.js` (module level) | No in-module production guard. Direct import of this service bypasses the `ff_authorize_simulated` feature flag silently. A developer who accidentally imports this instead of `pingOneAuthorizeService` skips real authorization with no error. | `if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_AUTHORIZE !== 'true') { throw new Error('simulatedAuthorizeService cannot be used in production'); }` |
| 23 | Major | Security | `agentMcpTokenService.js:1062-1081` | RFC 8693 §3 subject mismatch is logged as `console.warn` and a `tokenEvents` entry but does NOT throw. The mismatched exchanged token is returned to the caller and forwarded to the MCP server — a potential impersonation vector. | `if (mcpAccessTokenClaims.sub !== userSub) { throw throwTokenResolutionError('sub_mismatch', ...); }` |
| 24 | Major | Security | `middleware/tokenIntrospection.js:34-35` | Client credentials fall back across two env var pairs: `PINGONE_CLIENT_ID || ADMIN_CLIENT_ID` and `PINGONE_CLIENT_SECRET || ADMIN_CLIENT_SECRET`. A lower-privilege `ADMIN_CLIENT_ID` may be silently substituted. Inconsistent with `tokenIntrospectionService.js` (uses `PINGONE_WORKER_CLIENT_ID`) — two caches may represent different principals and produce conflicting results. | Consolidate to `PINGONE_WORKER_CLIENT_ID` / `PINGONE_WORKER_CLIENT_SECRET`; remove the fallback. |
| 25 | Major | Security | `middleware/tokenIntrospection.js:73-79` | Cache eviction sweep triggers only when `introspectionCache.size > 1000`. Below threshold, expired entries accumulate indefinitely. Above it, the full Map is iterated on every request — O(n) on the hot request path. | Move eviction to a dedicated `setInterval` running every 60 s rather than inline on the request path. |
| 26 | Major | Security | `services/transactionAuthorizationService.js:65` | `amount` is passed from caller to policy engines without numeric validation in this service. Negative amounts, NaN, and Infinity all pass through. | `if (!Number.isFinite(amount) || amount < 0) return { ran: false, reason: 'invalid_amount' };` |
| 27 | Major | Security | `services/tokenIntrospectionService.js:39` | Guard `if (!token)` catches falsy values but not non-string types. `hashToken` would call `crypto.createHash(...).update(token)` with a non-string, throwing a runtime TypeError rather than returning `{ valid: false }`. | `if (typeof token !== 'string' || !token.trim()) return { valid: false };` |
| 28 | Major | Security | `oauthService.js` (module) | No `validateState(received, expected)` helper. `generateState()` creates the value; `generateAuthorizationUrl()` embeds it; but state validation is left entirely to callers, making it easy to omit. | Add `validateState(receivedState, sessionState)` helper with JSDoc noting callers MUST invoke it on callback. |
| 29 | Major | Maintainability | `server.js:980-1535` | `POST /api/mcp/tool` handler is ~555 lines mixing: token resolution, MCP authorize gate, token introspection, remote MCP dispatch, HTTP/2 dispatch, auth-challenge interception, local fallback (three code paths), and SSE event publication. | Extract named async functions: `resolveToolToken()`, `runMcpAuthorizeGate()`, `runTokenIntrospection()`, `dispatchMcpTool()`. |
| 30 | Minor | Async | `routes/tokenChain.js:10,17` | `getTokenChain()` and `getMCPToolCalls()` awaited sequentially but are independent. Sequential await adds unnecessary latency. | `const [tokenChain, mcpCalls] = await Promise.all([getTokenChain(req.user.id), getMCPToolCalls(req.user.id)]);` |
| 31 | Minor | Async | `routes/oauth.js:499-503` | `POST /refresh` calls `req.session.save((err) => { if (err) console.error(…); })` then immediately returns `res.json(…)` without awaiting the save. If the session store fails, the refreshed token is lost and the next request sees the old (possibly expired) token. | Await the save before responding, or document the optimistic pattern explicitly. |
| 32 | Minor | Async | `middleware/tokenIntrospection.js:153-157` | Fail-open path calls bare `next()` with no marker attached to `req`. Downstream handlers cannot observe that introspection failed open. | `req.introspectionFailedOpen = true;` before `next()` so downstream middleware can log or audit the gap. |
| 33 | Minor | Async | `services/transactionAuthorizationService.js:184-189` | Catch block returns error objects to callers with no server-side trace log. An unexpected error in the policy engine leaves no observable signal. | Add `logAppEvent(...)` or `logger(...)` call inside the catch block. |
| 34 | Minor | Async | `services/tokenIntrospectionService.js:120` | `logAppEvent(...)` return value is discarded and called without `await`. Currently acceptable because `logEvent` is synchronous, but intent is not explicit. | Annotate: `/* synchronous — no await needed */` |
| 35 | Minor | Async | `agentTokenService.js:41` | `validateAgentActorToken` is `async` but contains no `await` — synchronous internally. | Either remove `async` (return plain object) or add real async validation. |
| 36 | Minor | Async | `pingOneAuthorizeService.js:392-421` | `checkStepUpRequired` catch block only `console.warn`s on evaluation failure — no structured app event. Consistent with `ff_authorize_fail_open` but makes distributed tracing difficult. | Add `logAppEvent('auth_lifecycle', 'warning', ...)` in the catch block. |
| 37 | Minor | Async | `configHostnameService.js` (module) | All exported functions are synchronous except `setConfiguredHostname` (async due to `configStore.setConfig`). No fire-and-forget patterns. | — CLEAN — |
| 38 | Minor | Memory | `delegationService.js:25-56` | In-memory store (`_mem = new Map()`) used on Vercel has no eviction. Revoked delegations remain in the Map indefinitely (status updated, entry never deleted). | Periodically delete revoked entries or cap the Map size. |
| 39 | Minor | Memory | `simulatedAuthorizeService.js:29-33` | `_recentSimulated` capped at 50 via `.slice(0, 50)`. `_seq` counter is unbounded but will never realistically overflow. | — CLEAN — |
| 40 | Minor | Security | `server.js:682-687` | `req.query.category`, `req.query.severity`, and `req.query.since` passed to `appEventService.getEvents()` without allowlist validation. Low risk for in-memory store, higher risk if the service evolves. | Validate `category` and `severity` against an allowlist array before passing. |
| 41 | Minor | Security | `server.js:988-989` | `console.log` prints the full `req.sessionID` string. If logs are shipped to an external aggregator, a session ID in plaintext is an information disclosure risk. | `req.sessionID?.slice(0, 8) + '…'` in log output. |
| 42 | Minor | Security | `routes/oauth.js:382-384` | `GET /logout` calls `oauthService.revokeToken()` twice without `.catch()`. Same pattern as the server.js logout — unhandled rejection risk. | `.catch(err => console.warn('[oauth/logout] revoke error:', err.message))` on each call. |
| 43 | Minor | Security | `services/mcpToolAuthorizationService.js:67` | `tool` name is forwarded to downstream policy engines and appears in `console.warn` messages without allowlist validation at this service boundary. | `const KNOWN_TOOLS = [...]; if (!KNOWN_TOOLS.includes(tool)) return { ran: false, reason: 'unknown_tool' };` |
| 44 | Minor | Security | `cibaService.js:129-143` | `pollForTokens(authReqId)` accepts any `authReqId` string without verifying it was initiated by the current session. An attacker with BFF access could poll with a guessed/stolen `auth_req_id`. | Accept a `sessionId` parameter; validate that `authReqId` was issued to this session before calling PingOne. |
| 45 | Minor | Security | `audValidationService.js:240` | `_createTestToken` exported from the production module. Test helpers should not appear in production exports. | Remove `_createTestToken` from `module.exports`; move to `__tests__/helpers.js`. |
| 46 | Minor | Security | `configHostnameService.js:33` | `HOSTNAME_REGEX` allows `http://` (non-TLS) hostnames to be stored as the BFF URL. In production, OAuth redirect URIs must be HTTPS. Misconfiguration produces opaque OAuth failures rather than a clear error. | `if (NODE_ENV === 'production' && hostname.startsWith('http://')) throw new InvalidHostnameError('Production requires https://');` |
| 47 | Minor | Security | `delegationService.js:117` | JSDoc does not state that `delegatorUserId` must originate from `req.session`, not the request body. | Add JSDoc: `@param {string} delegatorUserId - MUST be from authenticated session, never from request body.` |
| 48 | Minor | Security | `oauthService.js:855-857` | `revokeToken` adds `client_secret` directly to the request body regardless of configured auth method, bypassing `applyAdminTokenEndpointClientAuth`. For Basic-auth clients this sends credentials in both Authorization header and body. | Use `applyAdminTokenEndpointClientAuth(this.config, body, headers)` for the revoke call. |
| 49 | Minor | Security | `configStore.js:375-486` | `getEffective` env-fallback keys are lowercase, but `FIELD_DEFS` uses UPPERCASE keys. `configStore.get('PINGONE_ENVIRONMENT_ID')` hits the cache; `configStore.getEffective('pingone_environment_id')` hits the fallback map. Inconsistent casing risks subtle misses. | Document in JSDoc that `getEffective` keys must be lowercase to use the env fallback map. |
| 50 | Minor | Modern JS | `server.js:354` | `.then()/.catch()` chain inside `app.use()` breaks the `async/await` style used everywhere else in the file. | `app.use(async (req, res, next) => { try { await configStore.ensureInitialized(); next(); } catch (err) { next(err); } });` |
| 51 | Minor | Modern JS | `server.js:662,681,983,1270` | `require()` calls inside route handlers (e.g. `const _appEvents = require('./services/appEventService')` at line 983). Node caches these so there is no runtime cost after first call, but it obscures the module's dependency graph. | Move all `require()` calls to top of file with other imports. |
| 52 | Minor | Modern JS | `routes/transactions.js:285,343` | `req.body.amount` mutated in place after destructuring (`req.body.amount = Math.round(…)`), but the destructured `amount` binding (line 254) is stale. This shadowed-mutation pattern is the root cause of Critical finding #3. | `const normalizedAmount = Math.round(parsedAmount * 100) / 100;` — never mutate `req.body`. |
| 53 | Minor | Modern JS | `routes/transactions.js:534,581` | `console.log` lines include emoji (`💰`). Emoji in log lines can cause encoding issues in some log aggregators and is inconsistent with the rest of the codebase's plain-text log style. | Replace with `[Transaction]` prefix. |
| 54 | Minor | Modern JS | `services/tokenIntrospectionService.js:100-105` | Cache duration if/if block can be simplified to a single `Math.min` expression. | `const cacheDuration = result.exp ? Math.min(CACHE_TTL_MS, Math.max(0, result.exp * 1000 - Date.now())) : CACHE_TTL_MS;` |
| 55 | Minor | Modern JS | `agentMcpTokenService.js:354-362` | `generateTransactionId` uses a `Math.random()`-based UUID fallback for older Node. Node 18+ (required by this app) always has `crypto.randomUUID()`. The fallback is not cryptographically secure. | Remove the fallback; require `crypto.randomUUID()` directly. |
| 56 | Minor | Modern JS | `agentMcpTokenService.js:354` | `const crypto = require('crypto')` inlined inside `generateTransactionId`. | Hoist to module top-level. |
| 57 | Minor | Maintainability | `middleware/tokenIntrospection.js:15-16` | Duplicate cache: this file has its own `introspectionCache` (60 s TTL) separate from `tokenIntrospectionService.js` (30 s TTL). A revoked token could be active in one and expired in the other. `clearCache()` and `clearIntrospectionCache()` each only clear one. | Consolidate: have middleware delegate to `tokenIntrospectionService.validateToken()` and remove its local cache and `introspectToken()` function. |
| 58 | Minor | Maintainability | `middleware/tokenIntrospection.js:23-89` | `introspectToken()` is 67 lines mixing credential resolution, cache read, HTTP call, and eviction. Each concern should be its own small function. | Extract `resolveCredentials()`, `readCache()`, `callIntrospectionEndpoint()`, `evictExpired()`. |
| 59 | Minor | Maintainability | `middleware/tokenIntrospection.js:84` | `logger.error(...)` / `logger.debug(...)` style (object with methods) conflicts with `tokenIntrospectionService.js` calling `logger(LOG_CATEGORIES.AUTH, ...)` as a plain function. One shape is wrong — `logger.error` may be `undefined`. | Audit `utils/logger` exports and align all callers to the same invocation shape. |
| 60 | Minor | Maintainability | `routes/transactions.js:252-609` | `POST /` is ~357 lines mixing seven concerns: input validation, account re-hydration, HITL consent gate, session check, step-up MFA gate, Authorize policy evaluation, and transfer/deposit/withdrawal execution. | Extract: `validateTransactionInput()`, `runHitlConsentGate()`, `runStepUpGate()`, `runAuthorizePolicyGate()`, `executeTransfer()`, `executeTransaction()`. |
| 61 | Minor | Maintainability | `routes/transactions.js:395-434` | Step-up MFA gate logic repeated twice (for `STEP_UP_WITHDRAWALS_ALWAYS` and general threshold check) with near-identical `res.status(428).json(…)` payloads differing only in message and `amount_threshold`. | `buildStepUpResponse(description, acr, method, threshold, isHITL)` factory called from both branches. |
| 62 | Minor | Maintainability | `routes/oauth.js:375-413` vs `server.js:456-495` | Logout logic near-duplicated across two files. Dangerous divergence: `oauth.js` reads envId/region via `process.env.*` (stale); `server.js` uses `configStore.getEffective(…)` (live). If config changes at runtime, `oauth.js` logout uses the wrong PingOne signoff endpoint. | Shared `buildSignoffRedirect(req, res, tokens)` helper; `oauth.js` must use `configStore.getEffective(…)` consistently. |
| 63 | Minor | Maintainability | `services/transactionAuthorizationService.js:100-183` | Simulated and PingOne branches duplicate step-up/deny/permit response construction logic. Identical patterns repeated for both engines (lines 109-141 and 152-182). | Extract `buildPolicyResult(r, { useSimulated, policyId, runtimeSettings })` factory. |
| 64 | Minor | Maintainability | `services/transactionAuthorizationService.js:73-83` | Magic config key strings (`'authorize_enabled'`, `'ff_authorize_deposits'`, etc.) used inline without local named constants. A typo returns `undefined` silently. | Extract to named `const` at top of function. |
| 65 | Minor | Maintainability | `services/mcpToolAuthorizationService.js:185,269` | `console.warn(...)` used instead of the structured `logAppEvent` / `logger` pattern. These bypass the activity log ring buffer and are invisible to the admin UI. | Replace with `logAppEvent(EVENT_CATEGORIES.MCP, EVENT_SEVERITIES.WARNING, '...', { tag: '...' })`. |
| 66 | Minor | Maintainability | `services/mcpToolAuthorizationService.js:67-274` | `evaluateMcpFirstToolGate` is 208 lines handling flag/session/role checks, JWT decoding, and three decision branches. | Extract `buildMcpBlockResponse(type, engine, decisionId)` factory; separate simulated vs live branches into sub-functions. |
| 67 | Minor | Maintainability | `services/tokenIntrospectionService.js:120` | `logAppEvent` called with raw string `'introspection'` rather than `EVENT_CATEGORIES.INTROSPECTION` constant. `EVENT_CATEGORIES` is not imported. A typo silently produces uncategorised events. | Import `{ EVENT_CATEGORIES }` from `appEventService` and use `EVENT_CATEGORIES.INTROSPECTION`. |
| 68 | Minor | Maintainability | `oauthService.js:474-529,594-649` | `getAgentClientCredentialsToken` and `getAgentClientCredentialsTokenWithExpiry` are ~55-line functions sharing ~90% logic. Only the return shape differs. | Merge: `async getAgentClientCredentialsToken({ includeExpiry = false } = {})`. |
| 69 | Minor | Maintainability | `configStore.js:551-633` | `validateTwoExchangeConfig` is defined after the `ConfigStore` class but references `configStore` (singleton at line 942). Creates a forward reference that confuses readers and static analysis. | Move to after line 942 (after singleton declaration), or pass `configStore` as a parameter. |
| 70 | Minor | Maintainability | `agentMcpTokenService.js:1539-1589` | `mapErrorToStructuredResponse` defined AFTER the first `module.exports` block (line 1528) and appended via `module.exports.mapErrorToStructuredResponse = ...` (line 1589). Works in CommonJS but is fragile; the function is also called at line 1192 from code defined above it. | Move `mapErrorToStructuredResponse` to before the first `module.exports` block. |
| 71 | Minor | Maintainability | `pingOneAuthorizeService.js:636-662` | `_extractStepUpRequired` and `_extractHitlRequired` are nearly identical — both iterate `raw.obligations` and `raw.advice` checking a string pattern. | Refactor to `_extractObligationSignal(raw, pattern)` used by both. |
| 72 | Minor | Maintainability | `simulatedAuthorizeService.js:287-292` | `isSimulatedModeEnabled(configStore)` takes `configStore` as a parameter unlike every other service in this batch. Inconsistent dependency injection with no explaining comment. | Either import `configStore` at module top, or add a JSDoc comment explaining why dependency injection is used here. |
| 73 | Minor | Maintainability | `audValidationService.js:68-86` | Mismatch error message and structured log field `tokenAuds` are redundant — both carry the same information. | Keep the structured log field; simplify error string to `'aud mismatch'`. |
| 74 | Minor | Maintainability | `configHostnameService.js:102-104` | Comment "do NOT cache the fallback" is correct but easy to miss. A future developer could add `_hostnameCache = DEFAULT_HOSTNAME` as an optimization, breaking config hot-reloading. | Elevate to: `// INTENTIONAL: fallback is NOT cached — allows config changes and env-var overrides to apply without restart.` |
| 75 | Minor | Maintainability | `cibaService.js:154` | `maxAttempts = 60` and `intervalSeconds = 5` are undocumented defaults. The effective 5-minute max wait is invisible to readers. | Add comment: `// 60 attempts × 5s ≈ 5-minute timeout ceiling` |
| 76 | Minor | Maintainability | `server.js:249,286` | Rate limiter max values `20000`, `8000`, `500`, `300` are inline magic numbers. | `const DEV_GLOBAL_LIMIT = 20000; const PROD_GLOBAL_LIMIT = 8000;` etc. defined alongside the limiter. |
| 77 | Minor | Maintainability | `server.js:260-276` | `shouldSkipGlobalRateLimit()` contains hardcoded path strings that will silently diverge from actual routes as new endpoints are added. | `const RATE_LIMIT_SKIP_PATHS = new Set([…])` defined alongside the limiter. |
| 78 | Minor | Maintainability | `server.js:647-655` | Inline admin-role check for `/api/mcp/audit` is ad-hoc session logic duplicated from the `requireSession`/`authenticateToken` pattern. | Extract `requireAdminSession` middleware; reuse across all three or four places this pattern appears. |

---

## Findings by Review Dimension

### 1. Async Patterns

#### server.js

**Finding #4 — `POST /api/mcp/tool` has no outer try/catch (Major)**

The ~555-line handler starting at line 980 runs setup code (lines 983–1080) outside any `try` block. A synchronous throw in this preamble — from `mcpFlowSseHub.ensurePostTrace()` for example — produces an unhandled promise rejection that Express 4 cannot intercept via its error handler.

Fix: wrap the full handler body in one outer try/catch:
```js
async (req, res, next) => {
  try {
    // entire handler body
  } catch (err) {
    next(err);
  }
}
```

**Finding #5 — Fire-and-forget token revocation in logout (Major)**

`oauthService.revokeToken()` is called twice at lines 466–470 without `await` and without `.catch()`. Rejections from PingOne's revocation endpoint are silently swallowed.

Fix:
```js
oauthService.revokeToken(accessToken)
  .catch(err => console.warn('[logout] revoke error:', err.message));
```

**Finding #18 — No `unhandledRejection` handler (Major)**

Without a global rejection handler, Node v15+ crashes with no structured log when an async Express handler throws outside try/catch. Node pre-v15 silently swallows the error.

Fix:
```js
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});
```

#### routes/transactions.js

**Findings #6, #7 — Two `POST /consent-challenge` handlers without try/catch (Major)**

Both async handlers await PingOne calls with no outer try/catch. Rejections propagate unhandled in Express 4.

Fix: add `next` to handler signature and wrap body in `try { … } catch (err) { next(err); }`.

**Finding #30 — Sequential awaits for independent calls (Minor)**

`routes/tokenChain.js:10,17`: `getTokenChain()` and `getMCPToolCalls()` are independent but awaited sequentially.

Fix: `const [tokenChain, mcpCalls] = await Promise.all([getTokenChain(req.user.id), getMCPToolCalls(req.user.id)]);`

**Finding #31 — Session save race in POST /refresh (Minor)**

`req.session.save()` callback fires after `res.json()` is already sent. Session store failures are invisible to the client.

**Finding #32 — Fail-open path leaves no marker on req (Minor)**

`middleware/tokenIntrospection.js:153–157`: bare `next()` with no `req.introspectionFailedOpen = true` marker.

#### delegationService.js

**Findings #8, #9 — Error swallowing and missing try/catch (Major)**

`fetchPingOneUserByUsername().catch(() => ({ user: null }))` swallows network errors and 500s. `grantDelegation` body has no top-level try/catch, so internal SQLite errors surface as unformatted exceptions.

#### cibaService.js

**Findings #10, #11 — Unguarded axios calls (Major)**

Both `initiateBackchannelAuth` and `pollForTokens` call `axios.post` without try/catch, violating the error-enrichment pattern used everywhere else in the service layer.

#### agentMcpTokenService.js

**Findings #12, #13 — RFC 8693 error swallowing and fire-and-forget audit events (Major)**

`exchangeTokenRfc8693` catches errors and returns `null` — callers get zero diagnostic context. Multiple `void writeExchangeEvent(...)` calls suppress synchronous throw errors entirely.

#### pingOneAuthorizeService.js

**Finding #14 — No token caching; fresh fetch on every call (Major)**

`getWorkerToken()` at lines 106–141 makes a client-credentials HTTP round-trip on every invocation. All four major service methods call it independently.

Fix:
```js
if (_cachedWorkerToken && Date.now() < _workerTokenExpiresAt - 30000) {
  return _cachedWorkerToken;
}
```

#### oauthService.js

**Finding #15 — Dynamic require() in hot async methods (Major)**

`require('jsonwebtoken')` called inline inside `exchangeCodeForToken` and `refreshAccessToken`. Hoist to module top-level.

---

### 2. Memory Leaks

#### server.js

**Findings #16, #17 — Timer leak and no SIGTERM handler (Major)**

`oauthMonitor.startPeriodicHealthCheck()` creates an interval whose handle is discarded. No SIGTERM handler exists to call `server.close()` or `oauthMonitor.stop()`. Both will leak in containerised deployments.

Fix:
```js
const server = app.listen(PORT, () => { … });
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  oauthMonitor.stop();
});
```

And in `oauthMonitor`:
```js
this._intervalId = setInterval(…);
stop() { clearInterval(this._intervalId); }
```

#### services/tokenIntrospectionService.js

**Finding #19 — Unbounded introspectionCache Map (Major)**

The service-level cache Map has no pruning mechanism. Under high traffic with many unique tokens it grows for the process lifetime. The middleware's separate cache prunes at size >1000 but that is a different instance.

Fix: add a post-write sweep:
```js
introspectionCache.set(key, entry);
for (const [k, v] of introspectionCache) {
  if (Date.now() >= v.expiresAt) introspectionCache.delete(k);
}
```

#### delegationService.js

**Finding #38 — In-memory delegation store has no eviction (Minor)**

`_mem = new Map()` used on Vercel. Revoked delegations update status but the entry is never deleted. Under long-lived processes this accumulates indefinitely.

---

### 3. Security

#### agentTokenService.js

**Finding #1 — Security stub always returns valid (Critical)**

`validateAgentActorToken()` is a placeholder that unconditionally returns `{ valid: true, actorId: 'placeholder-actor-id', scopes: [...] }`. The function has production-looking JSDoc and emits real app events, making the stub invisible to reviewers who don't read line-by-line.

**Required action**: implement real validation via `tokenIntrospectionService.validateToken()` **or** remove all callers and replace with `audValidationService`. At minimum add:
```js
// SECURITY STUB — DO NOT USE IN PRODUCTION
// TODO(SECURITY): THIS IS A STUB — DOES NOT VALIDATE
```

#### middleware/tokenIntrospection.js

**Finding #2 — Insecure cache key (Critical)**

Cache key is the first 20 characters of the raw bearer token. Any two tokens with the same 20-char prefix share a cache slot.

Fix: use SHA-256 of the full token — the same approach as `tokenIntrospectionService.js`:
```js
const cacheKey = require('crypto').createHash('sha256').update(token).digest('hex');
```

#### routes/transactions.js

**Finding #3 — Stale-binding balance check (Critical)**

See Executive Summary. Fix: replace `amount` with `parsedAmount` on line 343.

#### configStore.js

**Findings #20, #21 — Dev key fallback and silent decrypt failure (Major)**

The fallback to `'dev-fallback-key-do-not-use-in-production'` with no warning is an easy production misconfiguration. Silent `''` return on decryption failure makes key rotation completely opaque to operators.

#### simulatedAuthorizeService.js

**Finding #22 — No in-module production guard (Major)**

The only guard is at the caller layer (`ff_authorize_simulated` flag check). A developer who directly imports this module bypasses all authorization.

#### agentMcpTokenService.js

**Finding #23 — RFC 8693 subject mismatch warns-not-throws (Major)**

A mismatched `sub` claim after token exchange is a potential impersonation vector. The exchanged token is returned to the caller and forwarded to the MCP server.

#### middleware/tokenIntrospection.js

**Finding #24 — Credential fallback to lower-privilege client (Major)**

`PINGONE_CLIENT_ID || ADMIN_CLIENT_ID` may silently substitute a lower-privilege client. Two caches backed by different principals produce conflicting introspection results.

**Finding #25 — O(n) eviction on hot request path (Major)**

Above 1000 entries, the full cache Map is iterated on every request.

#### services/transactionAuthorizationService.js

**Finding #26 — Amount not validated before policy engines (Major)**

Negative amounts, NaN, and Infinity pass through to PingOne Authorize and the simulated engine.

#### services/tokenIntrospectionService.js

**Finding #27 — Non-string token not guarded (Major)**

Guard `if (!token)` misses objects, arrays, and numbers. A non-string token throws a TypeError inside `hashToken`.

#### oauthService.js

**Finding #28 — No validateState() helper (Major)**

State validation is left entirely to callers, making it easy to omit.

#### Other security findings (Minor)

- **#40**: Unvalidated query params to `appEventService.getEvents()` in `server.js:682-687`
- **#41**: Full `req.sessionID` in `console.log` at `server.js:988-989`
- **#42**: `oauth.js:382-384` revokeToken without `.catch()`
- **#43**: `mcpToolAuthorizationService.js:67` — tool name without allowlist
- **#44**: `cibaService.js` — `pollForTokens` accepts any `authReqId` without session binding
- **#45**: `audValidationService.js:240` — test helper in production exports
- **#46**: `configHostnameService.js:33` — `http://` hostnames accepted in production
- **#47**: `delegationService.js:117` — JSDoc missing session-origin requirement
- **#48**: `oauthService.js:855-857` — `revokeToken` sends credentials in body and header for Basic-auth clients
- **#49**: `configStore.js:375-486` — case mismatch between `getEffective` keys and `FIELD_DEFS`

**Confirmed clean (security):**
- `server.js:156-191`: Helmet well-configured (HSTS 2yr, CSP, X-Frame-Options DENY, noSniff, referrer policy, hidePoweredBy)
- `server.js:205-212`: CORS uses explicit allowlist, not wildcard
- `server.js:243-293`: Rate limiting applied globally and to all four auth endpoints
- `routes/transactions.js:227-245`: IDOR check confirmed present — `transaction.userId !== req.user.id`
- `routes/oauth.js:183-196`: State parameter validated against session with PKCE cookie fallback
- `routes/oauth.js:80-81,216-228`: Nonce generated via `crypto.randomBytes(16)`, stored and validated on callback
- `routes/oauth.js:66-67,199,213`: PKCE verifier generated, stored, passed to exchange
- `routes/oauth.js:291-297`: Session regenerated before token storage (session fixation prevention)
- `services/audValidationService.js`: `aud` validation is strict/fail-closed, exact string equality, RFC-compliant
- `services/configHostnameService.js`: Hostname never derived from request headers — no SSRF risk
- `services/pingOneAuthorizeService.js`: All URL construction uses `configStore`-sourced values — no SSRF risk

---

### 4. Modern JS Standards

**Finding #50 — `.then()/.catch()` chain in app.use() (Minor, server.js:354)**

Inconsistent with the async/await style used throughout the file.

**Finding #51 — Inline require() in route handlers (Minor, server.js)**

`require()` calls inside handlers obscure the module's dependency graph.

**Finding #52 — req.body mutation causes Critical bug (Minor, routes/transactions.js)**

`req.body.amount` mutated after destructuring. The stale `amount` binding is the root cause of Critical finding #3. Adopting the `normalizedAmount` pattern would have prevented it.

**Finding #53 — Emoji in console.log (Minor, routes/transactions.js)**

`💰` in log lines risks encoding issues in some log aggregators.

**Finding #54 — if/if block can be Math.min (Minor, tokenIntrospectionService.js)**

Simplification opportunity with no semantic change.

**Findings #55, #56 — Math.random UUID fallback and inline require in agentMcpTokenService.js (Minor)**

Node 18+ (required by this app) always has `crypto.randomUUID()`. The `Math.random()` fallback is not cryptographically secure and should be removed.

---

### 5. Maintainability

**Finding #29 — 555-line MCP tool handler (Major, server.js:980-1535)**

`POST /api/mcp/tool` is the largest single maintainability risk in the codebase. It mixes seven distinct concerns with no shared abstraction.

**Finding #57 — Dual introspection cache (Minor)**

Two separate `introspectionCache` instances with different TTLs (60 s in middleware, 30 s in service). Cache invalidation (`clearCache()` / `clearIntrospectionCache()`) only clears one. A revoked token can be active in one cache and expired in the other.

**Finding #58 — `introspectToken()` mixes four concerns (Minor)**

67 lines in a single function: credential resolution, cache read, HTTP call, and eviction sweep.

**Finding #59 — Logger invocation shape mismatch (Minor)**

`middleware/tokenIntrospection.js` calls `logger.error(...)` while `tokenIntrospectionService.js` calls `logger(LOG_CATEGORIES.AUTH, ...)`. One form is wrong.

**Finding #60 — 357-line transaction POST handler (Minor)**

`routes/transactions.js POST /` mixes seven concerns. Top candidate for extraction into named sub-functions after the MCP tool handler.

**Finding #62 — Duplicate logout with stale env reads (Minor)**

`oauth.js` reads `process.env.PINGONE_ENVIRONMENT_ID` (stale at startup). `server.js` uses `configStore.getEffective(…)` (live). At runtime config change, `oauth.js` logout will sign out against the wrong PingOne tenant.

Other maintainability findings (#63–#78): magic strings, duplicated response builders, forward references, `console.warn` bypassing the activity log, module.exports fragmentation in `agentMcpTokenService.js`, and undocumented timeout ceilings in `cibaService.js`.

---

## Files Reviewed

- `services/appEventService.js` — clean (all 5 dimensions)
- `services/tokenIntrospectionService.js` — 1 Major (Memory), 1 Major (Security), 3 Minor (Maintainability, Async, Modern JS)
- `middleware/tokenIntrospection.js` — 1 Critical (Security), 2 Major (Security, Memory), 5 Minor (Maintainability, Async)
- `services/transactionAuthorizationService.js` — 1 Major (Security), 3 Minor (Maintainability, Async)
- `services/mcpToolAuthorizationService.js` — 3 Minor (Security, Maintainability)
- `server.js` — 4 Major (Async, Memory), 1 Major (Maintainability), 7 Minor (Security, Modern JS, Maintainability)
- `routes/transactions.js` — 1 Critical (Security), 2 Major (Async), 7 Minor (Security, Modern JS, Maintainability)
- `routes/tokenChain.js` — 1 Minor (Async); security dimensions clean
- `routes/oauth.js` — 2 Minor (Async, Security, Maintainability); state/nonce/PKCE/session fixation all clean
- `services/oauthService.js` — 1 Major (Async), 1 Major (Security), 2 Minor (Security, Maintainability)
- `services/cibaService.js` — 2 Major (Async), 2 Minor (Security, Maintainability); polling lifecycle clean (no setInterval)
- `services/agentTokenService.js` — 1 Critical (Security), 1 Major (Maintainability), 1 Minor (Async)
- `services/agentMcpTokenService.js` — 2 Major (Security, Async), 1 Major (Async), 3 Minor (Maintainability, Modern JS); RFC 8693 error coverage addressed
- `services/delegationService.js` — 2 Major (Async), 2 Minor (Memory, Security); identity verification present and correct
- `services/audValidationService.js` — 2 Minor (Security, Maintainability); aud matching strict and fail-closed
- `services/configStore.js` — 2 Major (Security), 2 Minor (Security, Maintainability); AES-256-GCM encryption confirmed
- `services/pingOneAuthorizeService.js` — 1 Major (Async/Performance), 3 Minor (Async, Maintainability, Security); SSRF risk confirmed absent
- `services/simulatedAuthorizeService.js` — 1 Major (Security), 2 Minor (Maintainability, Memory); in-memory buffer clean
- `services/configHostnameService.js` — 3 Minor (Security, Maintainability, Async); X-Forwarded-Host not read (no SSRF risk)

---

## Files Not Reviewed

The following service and route files were **not** covered in this pass and are candidates for a follow-up review:

**Services (not reviewed):**
- `services/accountService.js`
- `services/authorizationService.js`
- `services/bankingService.js`
- `services/cacheService.js`
- `services/consentService.js`
- `services/credentialService.js`
- `services/deviceAuthService.js`
- `services/deviceFlowService.js`
- `services/fido2Service.js`
- `services/flowTraceService.js`
- `services/groupService.js`
- `services/hitlService.js`
- `services/introspectionResultService.js`
- `services/mcpFlowSseHub.js`
- `services/notificationService.js`
- `services/passwordService.js`
- `services/pkceService.js`
- `services/populationService.js`
- `services/proxyService.js`
- `services/riskService.js`
- `services/roleService.js`
- `services/samlService.js`
- `services/sessionService.js`
- `services/signalService.js`
- `services/sseService.js`
- `services/stepUpService.js`
- `services/tokenChainService.js`
- `services/tokenExchangeService.js`
- `services/transactionService.js`
- `services/userService.js`
- `services/verifyService.js`
- `services/webAuthnService.js`

**Routes (not reviewed):**
- `routes/accounts.js`
- `routes/admin.js`
- `routes/auth.js`
- `routes/banking.js`
- `routes/ciba.js`
- `routes/consent.js`
- `routes/device.js`
- `routes/delegation.js`
- `routes/fido2.js`
- `routes/mcp.js`
- `routes/notifications.js`
- `routes/risk.js`
- `routes/saml.js`
- `routes/users.js`
- `routes/verify.js`
- `routes/webauthn.js`

**Middleware (not reviewed):**
- `middleware/adminAuth.js`
- `middleware/rateLimiter.js`
- `middleware/sessionAuth.js`
- `middleware/validateRequest.js`

**Utilities (not reviewed):**
- `utils/logger.js` — note: logger invocation shape inconsistency found (finding #59) suggests this file needs a pass
- `utils/errorHelpers.js`
- `utils/responseHelpers.js`
