# Testing Guide — Super Banking Demo

Comprehensive reference for every test in this monorepo: what exists, how to run it, what is mocked vs real, and what is not covered.

---

## Quick reference

| Layer | Runner | Command | Count |
|-------|--------|---------|-------|
| API server unit + integration | Jest | `cd banking_api_server && npm test` | ~2 038 tests / 105 suites |
| UI unit | Jest (CRA) | `cd banking_api_ui && npm run test:unit` | 343 tests / 25 suites |
| UI E2E (mock server) | Playwright | `cd banking_api_ui && npm run test:e2e` | 10 spec files |
| UI E2E (real server) | Playwright | `cd banking_api_ui && npm run test:e2e:real` | real-only specs |
| Live PingOne integration | Jest | `cd banking_api_server && npm run test:live` | ~35 tests (needs `.env`) |

### Test results files

Both `npm test` commands automatically write a datetime-named markdown report:

- **API server:** `banking_api_server/test-results/YYYY-MM-DD-HH-MM-SS-test-results.md`
- **UI:** `banking_api_ui/test-results/YYYY-MM-DD-HH-MM-SS-test-results.md`

Each report lists pass/fail per suite and per test, with failure excerpts. Reporter source: `banking_api_server/src/__tests__/setup/markdownReporter.js` and `banking_api_ui/src/reporters/markdownReporter.js`.
| Live token exchange (browser token) | Jest | `cd banking_api_server && npm run token:extract && npm run test:live:token` | token exchange suites |

---

## 1. API server tests (`banking_api_server/`)

All tests live under `src/__tests__/`. Run from `banking_api_server/`.

### 1.1 How to run

```bash
# All suites (default CI mode)
npm test

# Verbose output + coverage
npm run test:all          # verbose
npm run test:coverage     # + coverage report

# Focused groups
npm run test:unit         # step-up-gate, authorize-gate, runtime-settings, transaction-flows, demo-scenario
npm run test:auth         # all OAuth/auth-related suites
npm run test:bff-tokens   # redisWireUrl + bffSessionGating
npm run test:session      # session store, state cookie, BFF session

# Single suite
npx jest --testPathPattern=pingoneTestSseHub --forceExit --no-coverage

# PingOne test-page routes only
npm run test:pingone      # runs unit tests, then live tests if RUN_LIVE_TESTS=true
```

### 1.2 Test suites by domain

#### SSE / real-time streaming
| File | What it tests | Mock/Real |
|------|--------------|-----------|
| `pingoneTestSseHub.test.js` | `attach()`, `publish()`, `publishToken()`, `publishExchange()`, `publishApiCall()`, cleanup lifecycle, multi-subscriber broadcast, write-error resilience | All mock — no network |
| `mcpFlowSseHub.test.js` | Vercel KV bridge, dedup via `_receivedTs`, KV poller delivery, stream_end close | Mock KV client via `_testSetKvClient` |

#### PingOne test page routes
| File | What it tests | Mock/Real |
|------|--------------|-----------|
| `pingoneTestRoutes.test.js` | `GET /ai-agent-apps`, `POST /update-resources`, `POST /update-scopes`, `POST /update-apps`, `POST /update-user-spel`, `GET /diagnose-mcp-exchange`, `POST /fix-mcp-exchange` | All mocked (axios, managementService, oauthService) |
| `pingoneTestRoutes.routes.test.js` | `pingoneRequest` shape contract for `/authz-token` + `/agent-token`; `GET /events` SSE headers and initial comment | All mocked |
| `pingoneTestRoutes.ssePublish.test.js` | SSE side-effects for `/authz-token`, `/agent-token`, `/worker-token`: `publishToken` called with correct `id`/`status`/`decoded` on success and error paths (9 tests) | All mocked |

#### OAuth / authentication
| File | What it tests |
|------|--------------|
| `auth.test.js` | Token validation middleware, JWT parsing, session extraction |
| `authSession.test.js` | Session cookie lifecycle, session renewal |
| `authStateCookie.test.js` | OAuth state cookie creation, verification, expiry |
| `oauth-callback.test.js` | OAuth callback token storage, session binding |
| `oauth-e2e-integration.test.js` | Full OAuth flow, session management |
| `oauth-error-handling.test.js` | 401/403 error shapes, insufficient scope responses |
| `oauth-scope-integration.test.js` | Read/write/admin scope validation against all API endpoints |
| `oauth-login-resilience.test.js` | Retry and fallback on login failures |
| `oauth-redirect-uri.test.js` | Redirect URI matching and rejection |
| `oauthService.test.js` | Token fetch, refresh, CC grant logic |
| `oauthUserService.test.js` | User-facing OAuth token management |
| `oauthAuthorizeResource.test.js` | Resource parameter on authorize requests |
| `oauthClientRegistry.test.js` | Multi-client registration and lookup |
| `authorize-gate.test.js` | Authorization gate middleware |
| `authorize-routes-admin.test.js` | Admin-only route protection |
| `scope-integration.test.js` | Comprehensive scope checks across all endpoints |

#### Token exchange / delegation
| File | What it tests |
|------|--------------|
| `actClaimValidator.test.js` | RFC 8693 `act` claim structure and nesting |
| `agentMcpTokenService.test.js` | Agent-to-MCP token exchange orchestration |
| `agentDelegation.test.js` | Delegation chain from user → agent → MCP |
| `delegationChainValidationService.test.js` | Multi-hop delegation chain validity |
| `delegationClaimsService.test.js` | `may_act`, `act` claim construction |
| `delegationErrorDiagnostics.test.js` | Delegation failure diagnosis and error messages |
| `delegationValidationMiddleware.test.js` | Middleware that enforces delegation constraints |
| `enhancedTokenExchangeService.test.js` | RFC 8693 two-exchange chain |
| `rfc8693-compliance.test.js` | Full RFC 8693 spec compliance checks |
| `configStore-tokenExchange.test.js` | Config keys required for token exchange |
| `testTokenScenarios.test.js` | Token exchange happy and unhappy paths |
| `tokenIntrospection.test.js` | Introspect endpoint, opaque token handling |
| `tokenRefresh.test.js` | Access token refresh flow |
| `tokenRevocation.test.js` | RFC 7009 revocation (single, batch, session) |
| `token-structure-validation.test.js` | JWT payload shape contract |
| `dual-token-exchange-live.integration.test.js` | Two-exchange chain (gated, see §1.4) |
| `token-exchange-pingone.integration.test.js` | PingOne token exchange (gated, see §1.4) |
| `clientCredentialsTokenService.test.js` | CC token fetch for all app types |

#### MCP / agent
| File | What it tests |
|------|--------------|
| `mcp-inspector.test.js` | MCP inspector proxy route |
| `mcp-local-hitl.test.js` | Human-in-the-loop local flow |
| `mcpDecisionPolling.test.js` | Consent decision polling loop |
| `mcpToolAuthorizationService.test.js` | Tool-level authorization enforcement |
| `http2McpBridge.test.js` | HTTP/2 bridge to MCP server |
| `agentSessionMiddleware.test.js` | Agent session cookie and binding |
| `agentRateLimit.test.js` | Per-session agent rate limiting |
| `agentTransactionTracker.test.js` | Agent-initiated transaction tracking |
| `bankingAgentNl.test.js` | NL intent → banking tool routing |
| `bankingAgentLangGraphServiceIntegration.test.js` | LangGraph service integration |
| `nlIntentParser.test.js` | Natural-language intent parsing |
| `nlIntentSanitize.test.js` | NL input sanitization |
| `phase116-agent-comprehensive-flows.test.js` | Agent end-to-end flows (Phase 116) |

#### Session / BFF
| File | What it tests |
|------|--------------|
| `bffSessionGating.test.js` | BFF session gate, unauthenticated redirect |
| `session-store-resilience.test.js` | Session store failover, cold-start |
| `accounts-cold-start.test.js` | Accounts API cold-start session recovery |
| `redisWireUrl.test.js` | Upstash Redis URL parsing for Vercel |
| `configStore-saas.test.js` | SaaS config fallback chain |

#### Transactions / CIBA / step-up
| File | What it tests |
|------|--------------|
| `ciba.test.js` | CIBA flow initiation and polling |
| `cibaService.test.js` | CIBA service internals |
| `step-up-gate.test.js` | Step-up auth gate middleware |
| `transaction-flows.test.js` | Full transaction lifecycle |
| `transactionAuthorizationService.test.js` | Per-transaction authorization |
| `transactionConsentChallenge.test.js` | Consent challenge creation and resolution |
| `transaction-consent-challenge.test.js` | Consent challenge route integration |
| `transferHitlIntegration.test.js` | Transfer with HITL consent |

#### MFA / security
| File | What it tests |
|------|--------------|
| `mfaService.test.js` | MFA trigger, verification, fallback |
| `mfaTest.routes.test.js` | MFA test routes |
| `securityMonitoring.test.js` | Anomaly detection, alert thresholds |
| `auditLogger.test.js` | Audit log structure and persistence |
| `killSwitchService.test.js` | Emergency kill-switch service |

#### PingOne management / bootstrap
| File | What it tests |
|------|--------------|
| `pingoneBootstrapService.test.js` | Environment bootstrap (apps, RS, scopes) |
| `pingoneAudit.integration.test.js` | PingOne asset audit (gated, see §1.4) |
| `fixBankingResourceServer.test.js` | Resource server auto-repair |
| `resourceValidation.test.js` | Resource server scope validation |
| `scopeAudit.test.js` | Canonical scope audit |
| `scopeEnforcement.test.js` | Runtime scope enforcement |
| `scopePolicyEngine.test.js` | Scope policy rule engine |
| `clientRegistration.test.js` | Dynamic client registration |

#### RFC 9728 (Protected Resource Metadata)
| File | What it tests |
|------|--------------|
| `rfc9728-integration.test.js` | `/.well-known/oauth-protected-resource` endpoint |
| `rfc9728-verification.test.js` | Spec compliance checks |
| `rfc9728-compliance.test.js` (alias) | Full compliance assertion |
| `rfc9728ComplianceAuditService.test.js` | Audit service for compliance |
| `rfc9728-documentation-verification.test.js` | Doc string accuracy (currently failing — see §1.5) |
| `rfc9728-educational-verification.test.js` | Educational content validation |
| `rfc9728-integration-verification.test.js` | Integration assertion |

#### Identity / standardization
| File | What it tests |
|------|--------------|
| `identityFormatStandardizationService.test.js` | Identity format normalization |
| `standardizationValidation.test.js` | Validation of standardized identities |
| `migrationLayer.test.js` | Identity migration compatibility |

#### Other
| File | What it tests |
|------|--------------|
| `health.test.js` | `GET /api/health` shape and status |
| `logs.test.js` | Log endpoint, log level filtering |
| `runtime-settings-api.test.js` | Runtime settings CRUD |
| `demo-scenario-api.test.js` | Demo-mode scenario switching |
| `demoMode.test.js` | Demo mode flag and gating |
| `server-production-guard.test.js` | Production-only guards |
| `simulatedAuthorizeService.test.js` | Simulated authorize for demo flows |
| `phase195-delegation-error-middleware.test.js` | Delegation error middleware (Phase 195) |
| `agent-api-test.test.js` | Agent API smoke test |
| `agent-module-smoke.test.js` | Module-level import smoke test |

### 1.3 What is mocked

Every test suite that doesn't carry the word "live" or "integration" mocks all external I/O:

| Dependency | How it is mocked |
|-----------|-----------------|
| `axios` | `jest.mock('axios', () => ({ get, post, patch, delete: jest.fn() }))` — all HTTP calls to PingOne are intercepted |
| `configStore` | Returns a fixed `DEFAULT_CONFIG` object; no disk or DB reads |
| `pingoneManagementService` | All methods (`getApplications`, `getResourceServers`, etc.) are `jest.fn()` |
| `oauthService` | `getAgentClientCredentialsToken` etc. return hard-coded token strings |
| `apiCallTrackerService` | `trackApiCall` is a no-op `jest.fn()` |
| `auth` middleware | Injects a fake admin session; `requireScopes` / `requireAdmin` always call `next()` |
| `pingOneUserService` | `getUserById` is `jest.fn()` |
| Session (`req.session`) | Injected inline as `{ user: {...}, oauthTokens: {...} }` |
| Redis / Upstash | `session-store-resilience` mocks the store adapter directly |

### 1.4 Running mocked tests as real (live mode)

The suites below are gated behind `RUN_LIVE_TESTS=true` and hit actual PingOne endpoints. They require a valid `.env` in `banking_api_server/`.

> **Tip:** If you have logged in via the browser, run `npm run token:extract` to auto-populate `INTEGRATION_SUBJECT_ACCESS_TOKEN` without copy-paste. See §1.4a.

```bash
# All live tests
npm run test:live

# Individual gated suite
RUN_LIVE_TESTS=true npx jest --testPathPattern=live-pingone-integration --forceExit --no-coverage

# Two-exchange delegation chain (also needs a real user access token)
RUN_LIVE_TESTS=true \
INTEGRATION_SUBJECT_ACCESS_TOKEN='<paste from browser DevTools>' \
npx jest --testPathPattern=live-pingone-integration --forceExit --no-coverage

# PingOne management API (apps, RS, scopes)
RUN_LIVE_TESTS=true npx jest --testPathPattern=pingoneAudit.integration --forceExit --no-coverage

# Token-exchange integration
RUN_LIVE_TESTS=true npx jest --testPathPattern=token-exchange-pingone --forceExit --no-coverage
RUN_LIVE_TESTS=true npx jest --testPathPattern=dual-token-exchange-live --forceExit --no-coverage
```

**Required `.env` keys for live tests:**

```
PINGONE_ENVIRONMENT_ID=
PINGONE_REGION=com
PINGONE_ADMIN_CLIENT_ID=          PINGONE_ADMIN_CLIENT_SECRET=
PINGONE_USER_CLIENT_ID=           PINGONE_USER_CLIENT_SECRET=
PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID=   PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET=
PINGONE_AI_AGENT_CLIENT_ID=       PINGONE_AI_AGENT_CLIENT_SECRET=
PINGONE_WORKER_TOKEN_CLIENT_ID=   PINGONE_WORKER_TOKEN_CLIENT_SECRET=
ENDUSER_AUDIENCE=
AI_AGENT_AUDIENCE=
AGENT_GATEWAY_AUDIENCE=
PINGONE_RESOURCE_MCP_SERVER_URI=
```

### 1.4a Using your browser login token (no copy-paste required)

Instead of pasting tokens manually, you can extract the live access token from your most recent browser
login and have Jest pick it up automatically. The BFF stores real PingOne tokens in `sessions.db` after
every successful login — the script below reads the latest one.

**One-time setup:**
1. Start the server and log in via the browser (`npm start` then visit `/dashboard`)
2. Run the extraction script:

```bash
cd banking_api_server
npm run token:extract
```

That writes `banking_api_server/.env.test-tokens` (gitignored — never committed):

```
INTEGRATION_SUBJECT_ACCESS_TOKEN=eyJraWQi...  # real PingOne JWT from your session
RUN_LIVE_TESTS=true
RUN_PINGONE_TOKEN_INTEGRATION=true
```

**Run live token tests:**

```bash
# Token exchange suites (uses .env.test-tokens automatically)
npm run test:live:token

# Or any gated suite — token is injected by Jest globalSetup
RUN_LIVE_TESTS=true npm test -- --testPathPattern=dual-token-exchange-live --forceExit

# All live tests (requires full .env + token)
npm run test:live
```

**How it works:**

`jest.config.js` has a `globalSetup` pointing at `src/__tests__/setup/loadBrowserToken.js`.
This runs once before any suite loads and reads `.env.test-tokens` into `process.env`.
Existing environment variables (CI, shell export) always win — the file is a fallback only.

**Token lifetime:** PingOne access tokens are short-lived (~60 min by default). Re-run
`npm run token:extract` after each browser login to refresh. The script prints the expiry
time so you know how long the token is valid.

**Why not always use real tokens?**

Most suites mock everything intentionally — they test business logic without network calls
and run in < 1 s. Real-token suites test the actual PingOne exchange chain and require
live credentials. Keep them separate so CI stays fast and offline.

### 1.5 Known pre-existing failures (not introduced by SSE work)

These 5 suites fail in the current codebase before any recent changes:

| Suite | Root cause |
|-------|-----------|
| `integration/completeFlow.test.js` | Integration fixture depends on a running server; no `globalSetup` in default Jest config |
| `mcpToolAuthorizationService.test.js` | Mock timing issue with async tool-auth resolution |
| `nlIntentParser.test.js` | Model response fixture out of sync with parser refactor |
| `rfc9728-documentation-verification.test.js` | Checks doc strings that were updated without updating the test fixtures |
| `mfaService.test.js` | MFA provider mock returns unexpected shape after a refactor |

---

## 2. UI unit tests (`banking_api_ui/`)

### 2.1 How to run

```bash
cd banking_api_ui

# Interactive watch mode (default CRA)
npm test

# Non-interactive (CI)
npm run test:unit
```

### 2.2 Test files

| File | What it tests |
|------|--------------|
| `src/__tests__/accountsHydration.test.js` | Accounts store hydration from session |
| `src/__tests__/App.session.test.js` | App-level session guard and redirect |
| `src/context/__tests__/AgentUiModeContext.test.js` | Agent UI mode context provider |
| `src/context/__tests__/ThemeContext.test.js` | Theme context switching |
| `src/utils/__tests__/authUi.test.js` | Auth utility helpers (token parse, expiry) |
| `src/utils/__tests__/embeddedAgentFabVisibility.test.js` | FAB show/hide logic |
| `src/utils/__tests__/bankingAgentFloatingDefaultOpen.test.js` | Agent panel default-open state |
| `src/services/__tests__/spinnerService.test.js` | Global spinner increment/decrement |
| `src/services/__tests__/apiClient.session.test.js` | `apiClient` 401 retry and session cookie path |
| `src/services/__tests__/oauth-ui-integration.test.js` | OAuth status polling, token expiry display |
| `src/services/__tests__/logger.test.js` | Named logger factory: prefix formatting, debug/info/warn/error output, multi-arg passthrough (6 tests) |
| `src/components/__tests__/SideNav.snapshot.test.js` | SideNav snapshot (admin vs user) |
| `src/components/__tests__/Header.snapshot.test.js` | Header snapshot |
| `src/components/__tests__/Footer.snapshot.test.js` | Footer snapshot |
| `src/components/__tests__/CimdSimPanel.test.js` | CIMD simulation panel interaction |
| `src/components/__tests__/DemoDataPage.test.js` | Demo data page render and filter |
| `src/components/__tests__/LogViewer.test.js` | Log viewer pagination and filter |
| `src/components/__tests__/DelegatedAccessPage.test.js` | Delegated access page render |
| `src/components/__tests__/BankingAgent.chips.test.js` | Agent chip rendering, action dispatch, suggestion prompts, consent-block, config-focus mode, dashboard button placement (60 tests) |
| `src/components/__tests__/PingOneTestPage.sse.test.jsx` | `EventSource` lifecycle (open, close, unmount), SSE message routing for `token`/`exchange`/`api_call` events, malformed JSON handling (10 tests) |
| `src/components/__tests__/WebMcpPanel.test.jsx` | Feature-flag gate, tool listing, tool selection, parameter inputs, SSE stream events, tool result display, error handling (18 tests) |
| `src/components/__tests__/buttonRouting.test.js` | Button navigation routing |
| `src/components/__tests__/PingOneAudit.test.jsx` | PingOne audit panel result display |
| `src/components/shared/__tests__/EducationDrawer.test.js` | Education drawer open/close |
| `src/components/MCPToolsEducation.test.tsx` | MCP tool education panel content |

### 2.3 What is mocked (UI)

| Dependency | Mock approach |
|-----------|--------------|
| `apiClient` / `axios` | Jest module mock; no real HTTP |
| `localStorage` / `sessionStorage` | CRA test environment provides in-memory stubs |
| React Router | `MemoryRouter` wraps components under test |
| OAuth status API | Inline `jest.fn()` returning fixture data |
| `EventSource` (SSE) | `window.EventSource` replaced with `MockEventSource` class in `PingOneTestPage.sse.test.jsx`; fires synthetic `onmessage` events to drive routing tests |
| `console.*` (logger) | `jest.spyOn(console, 'log/info/warn/error')` in `logger.test.js`; logger tests run in dev mode so `debug`/`info` pass through — set `NODE_ENV=production` and `window.__BANKING_DEBUG__=false` to test production silencing |

---

## 3. UI E2E tests (Playwright)

### 3.1 How to run

```bash
cd banking_api_ui

# All E2E (mock server, no real PingOne)
npm run test:e2e

# Specific suites
npm run test:e2e:admin       # admin dashboard
npm run test:e2e:customer    # customer dashboard
npm run test:e2e:agent       # banking agent
npm run test:e2e:security    # security settings
npm run test:e2e:session     # session regression
npm run test:e2e:landing     # marketing / landing page

# Real server (both UI and API must be running)
npm run test:e2e:real
# or with explicit URL:
E2E_BASE_URL=http://localhost:3000 npm run test:e2e:real:local

# API-layer E2E (no browser)
npm run test:e2e:api
```

### 3.2 Spec files

| File | What it tests | Real/Mock |
|------|--------------|-----------|
| `tests/e2e/customer-dashboard.spec.js` | Account list, balance display, transfer flow | Mock server |
| `tests/e2e/admin-dashboard.spec.js` | Admin login, user management, config | Mock server |
| `tests/e2e/banking-agent.spec.js` | Agent chat, tool invocation, HITL consent | Mock server |
| `tests/e2e/banking-agent.real.spec.js` | Same flows against a live agent | Real server only |
| `tests/e2e/security-settings.spec.js` | MFA enrollment, session settings | Mock server |
| `tests/e2e/session-regression.spec.js` | OAuth callback, session persistence, token refresh | Mock server |
| `tests/e2e/landing-marketing.spec.js` | Landing page routes, marketing copy | Mock server |
| `tests/e2e/banking-operations.spec.js` | Transfer, payment, statement download | Mock server |
| `tests/e2e/health.spec.js` | `/api/health` response shape | Mock or real |
| `tests/integration/serverRestart.spec.js` | Session survival after server restart | Real server |

### 3.3 Mock vs real for E2E

The default `playwright.config.js` points at `http://localhost:3000` and starts both servers via `webServer`. All PingOne calls are intercepted by the BFF using mocked `oauthService` fixtures loaded in `NODE_ENV=test`.

To run against real PingOne:
1. Start the stack with real `.env`: `npm start` (API) + `npm start` (UI)
2. Use `npm run test:e2e:real` — this config skips `webServer` and uses the already-running stack.
3. Tests in `banking-agent.real.spec.js` and `tests/integration/serverRestart.spec.js` are real-only and not run by the default `test:e2e` command.

---

## 4. What is NOT covered

### ~~SSE client (UI)~~ ✅ Covered
`PingOneTestPage.sse.test.jsx` now covers `EventSource` lifecycle, `token`/`exchange`/`api_call` event routing, and malformed-JSON resilience using a `MockEventSource` class. `pingoneTestRoutes.ssePublish.test.js` covers the server-side `publishToken`/`publishExchange` SSE side-effects.

### `ApiCallDisplay` polling → SSE migration
`ApiCallDisplay` still polls `/api/api-calls` every 10 s. The SSE hub already publishes `api_call` events, but the component doesn't consume them. No test covers whether live `api_call` events reach the UI.

### Token expiry display / time-remaining countdown
The `formatTimeRemaining` / `isTokenValid` helpers in `PingOneTestPage` are untested.

### Worker token SSE update
`publishToken` with `id: 'worker-token'` updates `workerDecoded` and `workerTokenExpiry` via SSE, but `setWorkerToken` (the status string) is NOT updated via SSE — it continues to be set only by the `loadWorkerToken()` API call. This asymmetry is untested.

### ~~`pingoneTestRoutes.js` token endpoints~~ ✅ Covered
SSE side-effects (`publishToken`/`publishExchange`) for `/authz-token`, `/agent-token`, and `/worker-token` are fully covered by `pingoneTestRoutes.ssePublish.test.js` (success, error, and decoded-payload paths).

### Vercel production session store
`redisWireUrl.test.js` tests URL parsing. The full Upstash Redis session round-trip under Vercel serverless constraints (cold start, multiple instances) has no automated test.

### MCP WebSocket / HTTP/2 transport
`http2McpBridge.test.js` covers the bridge logic, but actual WebSocket frame-level behavior (reconnect, backpressure) is not tested.

### Playwright coverage for PingOne test page
No E2E spec exercises the PingOne test page UI (token fetch buttons, asset verification, scope repair).

### Pre-existing failing suites (§1.5)
`integration/completeFlow.test.js`, `mcpToolAuthorizationService.test.js`, `nlIntentParser.test.js`, `rfc9728-documentation-verification.test.js`, `mfaService.test.js` — these were failing before any recent changes and represent debt, not regressions.

---

## 5. TypeScript service tests (MCP server, gateway, agent, invest)

These four services use TypeScript Jest and share a common test architecture. Each is built and tested independently.

### 5.1 How to run all services from repo root

```bash
# Run all root-level test commands in one pass
npm test

# Or individual service test suites
npm run test:api-server              # Banking API server (§1)
npm run test:mcp-server              # MCP server (TypeScript)
npm run test:mcp-server:integration  # MCP server integration tests only
npm run test:ui                      # Banking UI (§2)
npm run test:agent                   # LangChain agent (Python)
npm run test:agent:full              # LangChain agent (full suite)
npm run test:agent-ui                # LangChain agent frontend (React)
npm run test:mcp-inspector           # API server MCP inspector routes
npm run test:bff-tokens              # API server Redis/session tests
npm run test:session                 # API server session store tests
npm run test:e2e:ui                  # UI E2E (Playwright)
npm run test:e2e:ui:smoke            # UI E2E smoke tests
```

### 5.2 MCP server tests (`banking_mcp_server/`)

**Test runner:** Jest with `ts-jest` preset (TypeScript)  
**Config:** `jest.config.js` with preset `ts-jest`, testEnvironment `node`  
**Run from:** `banking_mcp_server/` or use `npm run test:mcp-server` from root

```bash
# From banking_mcp_server/
npm run test:unit              # Unit tests (excludes integration)
npm run test:integration       # Integration tests only
npm test                       # All (unit + integration)
npm run test:watch             # Watch mode
npm run test:coverage          # Coverage report (text, lcov, html)
npm run test:ci                # CI mode (coverage, no watch)
```

**Notable mocking patterns:**
- ESM-only packages (`uuid`, `jose`) mapped to CJS shims in `jest.config.js`
- `uuid` shim: RFC 4122 v4 via Node `crypto`
- `jose` shim: stub functions (tests mock actual token operations)
- Test environment: `node` (not browser)

**Coverage:** Collected from `src/**/*.ts` (excluding `.d.ts`), reports in `coverage/` dir

### 5.3 MCP gateway tests (`banking_mcp_gateway/`)

**Test runner:** Jest with `ts-jest` preset (TypeScript)  
**Config:** Inline `jest` field in `package.json`  
**Run from:** `banking_mcp_gateway/` or use root npm scripts (not yet wired at root level)

```bash
# From banking_mcp_gateway/
npm test                  # All tests with --forceExit
npm run test:watch       # Watch mode
```

**Notable details:**
- `testMatch`: `**/tests/**/*.test.ts` (all test files live in `tests/` directory)
- `forceExit: true` by default (required for server-style async cleanup)
- Includes `tdd-guard-jest` reporter for test structure validation

### 5.4 Agent service tests (`banking_agent_service/`)

**Test runner:** Jest with `ts-jest` preset (TypeScript)  
**Config:** Inline `jest` field in `package.json`  
**Run from:** `banking_agent_service/` or use root npm scripts (not yet wired at root level)

```bash
# From banking_agent_service/
npm test                  # All tests with --forceExit
```

**Notable details:**
- `testMatch`: `**/tests/**/*.test.ts`
- `forceExit: true` by default (async/await cleanup)
- Includes `tdd-guard-jest` reporter for regression tracking
- No `test:watch` or `test:coverage` scripts (minimal setup for agent orchestrator)

### 5.5 Invest service (no tests)

**Status:** `banking_mcp_invest/` has no test suite defined in `package.json`  
**Reason:** Pure MCP tool server; testing delegated to integration tests via MCP gateway

---

## 6. Test reporters and CI integration

### 6.1 TDD Guard Jest reporter

All active Jest suites are configured with the `tdd-guard-jest` reporter to track test structure quality and catch common anti-patterns:

```javascript
reporters: [
  'default',
  ['tdd-guard-jest', { projectRoot: '/Users/curtismuir/Development/banking' }]
]
```

**Services using TDD Guard:**
- `banking_api_server` (via `jest.config.js`)
- `banking_mcp_server` (via `jest.config.js`)
- `banking_mcp_gateway` (via `package.json` jest field)
- `banking_agent_service` (via `package.json` jest field)
- `banking_mortgage_service` (via `package.json` jest field)
- `banking_hitl_service` (via `package.json` jest field)

**What it validates:**
- Test nesting and organization
- Assertion patterns (avoid empty test bodies)
- Anti-patterns in test structure
- Regression flag tracking

### 6.2 Jest version: 30.4.2 across all services

**Unified upgrade completed** — all Node services now run Jest `^30.4.2`:

| Service | Jest version |
|---------|--------------|
| `banking_api_server` | (inherits from devDependencies at root) |
| `banking_api_ui` | Via CRA (embedded version) |
| `banking_mcp_server` | `^30.4.2` |
| `banking_mcp_gateway` | `^30.4.2` |
| `banking_agent_service` | `^30.4.2` |
| `banking_mortgage_service` | `^30.4.2` |
| `banking_hitl_service` | `^30.4.2` |
| `langchain_agent` | N/A (Python pytest) |

**No known Jest 30 compatibility issues** in the test suite. All builds are clean (`npm run build` exits 0).

---

## 7. Running the full test suite from root

The authoritative test runner is `/scripts/run-all-tests.sh`, wired as `npm test` in root `package.json`:

```bash
npm test
```

**This script runs sequentially:**
1. `banking_api_server`: `npm test -- --forceExit` (~2000 tests, ~2-3 min)
2. `banking_mcp_server`: `npm run test:unit` (TypeScript, unit only; ~30-60 sec)
3. `banking_api_ui`: `npm run test:unit` (React, non-interactive; ~1-2 min)
4. `langchain_agent`: Python pytest (if Python 3.12 or 3 available; ~1-2 min)
5. `langchain_agent/frontend`: `npm run test:ci` (React, stable subset; ~30-45 sec)

**Total runtime:** ~5-8 minutes (all services, full coverage)

**Environment variables set by script:**
- `NODE_ENV=test` (global for all steps)
- `CI=true` (global; triggers non-interactive mode)

**Failure handling:**
- Script exits with code 1 if ANY service fails
- Each service runs independently; failure in one does not stop the others
- Final summary shows which steps passed/failed

**Skips:**
- `langchain_agent` pytest is skipped if Python is not found (logged as warning, but counts as FAILED in exit code)
- Other services are always run (Node is a hard requirement)

---

## 8. Coverage thresholds and reporting

### 8.1 API server coverage

**Configured in:** `banking_api_server/jest.config.js`  
**Thresholds:** Not explicitly set; defaults to no minimum  
**Reports:** Markdown report auto-written to `banking_api_server/test-results/YYYY-MM-DD-HH-MM-SS-test-results.md`

To view coverage:
```bash
cd banking_api_server
npm run test:coverage
# Opens coverage/index.html in browser (run: `open coverage/index.html`)
```

### 8.2 MCP server coverage

**Configured in:** `banking_mcp_server/jest.config.js`  
**Thresholds:** Not explicitly set  
**Reporters:** `text`, `lcov`, `html` (standard Jest defaults)  
**Directory:** `banking_mcp_server/coverage/`

To view:
```bash
cd banking_mcp_server
npm run test:coverage
open coverage/index.html
```

### 8.3 UI coverage

**Configured via:** Create React App defaults (CRA manages Jest config)  
**Thresholds:** None enforced in CI  
**Reports:** Standard CRA test output (no markdown report like API server)

---

## 9. Debugging and troubleshooting

### 9.1 TypeScript compilation errors in service tests

MCP server, gateway, and agent service use `ts-jest` to compile `.ts` files at test time. If you see `Cannot find module` or `Unknown syntax` errors:

```bash
# Verify TypeScript is installed
npm list typescript

# Rebuild to catch compile errors early
npm run build

# Run with verbose output
NODE_ENV=test npx jest --verbose
```

### 9.2 Jest timeout or "forceExit" warnings

The `--forceExit` flag is necessary for server-style tests (open ports, WebSocket listeners). Do NOT remove it from service tests. If a test hangs:

```bash
# Run with explicit timeout (default 5000 ms)
npx jest --testTimeout=10000

# Check for unclosed handles
npm run test -- --detectOpenHandles
```

### 9.3 Module resolution (uuid, jose shims)

MCP server remaps ESM-only packages to CJS shims. If you see `Cannot find module 'uuid'`:

1. Verify `jest.config.js` has `moduleNameMapper` for `uuid` and `jose`
2. Check that shim files exist: `src/__mocks__/uuid-cjs.js`, `src/__mocks__/jose-cjs.js`
3. Run tests with `NODE_ENV=test` explicitly set

### 9.4 TDD Guard reporter warnings

The `tdd-guard-jest` reporter flags anti-patterns like empty test bodies or deep nesting. If you see warnings:

- Review the flagged test file (line number is in the warning)
- Common fixes: add actual assertions, flatten nesting, or rename to clarify intent
- These are warnings only; they do not cause test failure

---
