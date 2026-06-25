
# Real API Test Suite Design

**Date:** 2026-05-21
**Scope:** Replace mocked BFF tests with real HTTP calls through `https://api.ping.demo:3001`, covering all 6 verticals and validating the full bootstrap contract.

---

## Problem

~110 test files in `demo_api_server/src/__tests__/` mock `middleware/auth`, `data/store`, `services/configStore`, and PingOne token exchange. A test can pass while the real request path (browser → CRA proxy → BFF → PingOne) is broken. Mock drift has previously allowed regressions in the OAuth callback, HITL enforcement, and token exchange chain to go undetected until manual QA.

---

## Approach: Parallel Real-Call Suite

Keep all existing mocked tests untouched as a regression floor. Build a new `tests/real/` tree that drives calls through the actual running BFF. Once a `tests/real/` file is green, delete its `src/__tests__/` counterpart. Old suite stays green throughout the migration — no period of broken CI.

---

## Architecture

### Request path

```
Test process
  → axios (https://api.ping.demo:3001)
      → BFF Express (TLS, session middleware, real auth, real configStore)
          → PingOne (token validation, token exchange)
          → data/store (real in-memory store + LMDB)
          → demo_mcp_server (for MCP tests only)
```

### Directory structure

```
demo_api_server/
  tests/real/
    helpers/
      session.js          — headless login + sessions.db fallback + skip sentinel
      bffClient.js        — axios instance with session cookie + vertical switch helpers
      fixtures.js         — bootstrapFixtures(verticalId) for all 6 verticals
      reset.js            — POST /api/admin/reset-demo + balance restore
      globalSetup.js      — orchestrates session + fixture bootstrap
      globalTeardown.js   — restores banking vertical, removes .test-session.json
      suiteSetup.js       — per-file skipIfNoSession() guard
    shared/
      bootstrap.test.js   — full provisioning contract validation (runs first)
      health.test.js
      oauth-status.test.js
      admin.test.js
      mcp.test.js
      config.test.js
    banking/
      accounts.test.js
      transactions.test.js
      transfers.test.js
      hitl.test.js
      agent.test.js
      vertical.test.js
    retail/               — same files, beforeAll switches to retail vertical
    sporting-goods/
    healthcare/
    workforce/
    admin/
  jest.real.config.js
```

---

## Section 1: Jest Configuration

**`demo_api_server/jest.real.config.js`:**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/real/**/*.test.js'],
  globalSetup: '<rootDir>/tests/real/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/real/helpers/globalTeardown.js',
  setupFilesAfterEnv: ['<rootDir>/tests/real/helpers/suiteSetup.js'],
  testTimeout: 30000,
  runInBand: true,
  forceExit: true,
  verbose: true,
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/'],
};
```

`runInBand: true` is required because vertical switches (`PUT /api/config/vertical`) are server-wide state — parallel workers would interleave vertical contexts.

**New npm scripts in `demo_api_server/package.json`:**

```json
"test:real":                "RUN_REAL_TESTS=true jest --config=jest.real.config.js",
"test:real:banking":        "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/banking",
"test:real:retail":         "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/retail",
"test:real:sporting-goods": "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/sporting-goods",
"test:real:healthcare":     "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/healthcare",
"test:real:workforce":      "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/workforce",
"test:real:admin":          "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/admin",
"test:real:shared":         "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/shared",
"test:real:smoke":          "RUN_REAL_TESTS=true jest --config=jest.real.config.js --testPathPattern=real/shared/health"
```

Default `npm test` (existing mocked suite) is untouched.

---

## Section 2: Session & Auth

### Resolution order

```
1. Headless PKCE login
   env: PINGONE_TEST_USER + PINGONE_TEST_PASSWORD (enduser)
        PINGONE_TEST_ADMIN_USER + PINGONE_TEST_ADMIN_PASSWORD (admin)
   flow: authorize → credentials → resume → code → BFF /api/auth/oauth/callback
   result: connect.sid cookie from BFF Set-Cookie

2. sessions.db fallback
   query: SELECT sid, sess FROM sessions ORDER BY expire DESC LIMIT 10
   filter: sess JSON has oauthTokens.accessToken with non-expired payload.exp
   result: connect.sid cookie built from the raw session ID (sid column) — the
           same ID the BFF already issued, so the existing session is valid

3. Skip sentinel
   writes { skip: true } to .test-session.json
   all suites call skipIfNoSession() in beforeAll — suite skipped, not failed
```

### Two session personas

| Persona | Env vars | Used for |
|---|---|---|
| `enduser` | `PINGONE_TEST_USER` / `PINGONE_TEST_PASSWORD` | Banking/vertical route tests |
| `admin` | `PINGONE_TEST_ADMIN_USER` / `PINGONE_TEST_ADMIN_PASSWORD` | `/api/admin/*` tests; falls back to enduser for non-admin routes |

Both cached in `.test-session.json` (gitignored). Loaded once in `globalSetup`, shared across all workers.

### `bffClient.js`

```js
// Thin axios wrapper
axios.create({
  baseURL: 'https://api.ping.demo:3001',
  httpsAgent: new https.Agent({ rejectUnauthorized: false }), // mkcert self-signed
  headers: { Cookie: session.cookie },
  withCredentials: true,
})

// Vertical helpers
setVertical(id)      // PUT /api/config/vertical { verticalId: id }; records previous
restoreVertical()    // PUT /api/config/vertical back to recorded value
```

---

## Section 3: Fixtures & Data Reset

### Fixture accounts

`bootstrapFixtures(verticalId)` called in `globalSetup` for all 6 verticals. Creates isolated accounts under user `test-real-suite` that never collide with demo user data.

| Vertical | Account IDs | Account type labels |
|---|---|---|
| `banking` | `chk-test-real-banking`, `sav-test-real-banking` | Checking / Savings |
| `retail` | `chk-test-real-retail`, `sav-test-real-retail` | Rewards Points / Store Credit |
| `sporting-goods` | `chk-test-real-sporting-goods`, `sav-test-real-sporting-goods` | Pro Member / Elite Member |
| `healthcare` | `chk-test-real-healthcare`, `sav-test-real-healthcare` | Primary Care / Specialist |
| `workforce` | `chk-test-real-workforce`, `sav-test-real-workforce` | PTO Balance / Benefits Allowance |
| `admin` | `chk-test-real-admin`, `sav-test-real-admin` | Checking / Savings |

Starting balances (constants in `fixtures.js`):
- `CHECKING_BALANCE = 10_000`
- `SAVINGS_BALANCE = 5_000`

Large enough that no test transfer/withdraw hits $0. Results cached in `.test-fixtures.json` (gitignored), shared across workers.

### Reset strategy

| Level | When | How |
|---|---|---|
| Suite reset | `beforeAll` in any write suite | `POST /api/admin/reset-demo` + `PUT /api/admin/accounts/:id` to restore starting balances |
| Per-test reset | `afterEach` in transfer/HITL suites only | Restore individual account balances to prevent intra-suite bleed |

### Vertical-specific fixture bootstrap

Each vertical folder's `beforeAll`:
1. `setVertical(verticalId)` — switches server-wide vertical
2. Verifies fixture accounts exist for this vertical
3. Resets balances to known starting values

Each vertical folder's `afterAll`:
1. `restoreVertical()` — switches back to `banking`

`banking/` skips the switch since it's the default.

---

## Section 4: Test Coverage

### Per-vertical test files (× 6 verticals)

| File | Endpoints | Real signal vs mocked |
|---|---|---|
| `accounts.test.js` | `GET /api/accounts/my`, `GET /api/accounts/:id/balance` | Real store data, real auth scope check, real configStore flags |
| `transactions.test.js` | `GET /api/transactions`, filtering, pagination | Real LMDB query, real date filtering |
| `transfers.test.js` | `POST /api/transactions` (transfer/deposit/withdraw) | Real balance mutation, real HITL threshold from `.env`, real rollback |
| `hitl.test.js` | `POST /api/transactions` HITL enforcement | Real `ff_hitl_enabled` from configStore, real consent challenge lifecycle |
| `agent.test.js` | `POST /api/agent/delegate` | Real RFC 8693 token exchange, real `act` claim in MCP token |
| `vertical.test.js` | `GET /api/config/vertical` | Real manifest shape, terminology labels, CSS vars per vertical |

### Shared test files

| File | Endpoints | Notes |
|---|---|---|
| `bootstrap.test.js` | Health, vertical list, oauth status, CC token, RFC 8693 exchange | Runs first; validates full provisioning contract |
| `health.test.js` | `GET /api/health` | Smoke — proves BFF is up |
| `oauth-status.test.js` | `GET /api/auth/oauth/status`, `/user/status` | Auth pipeline — everything depends on this |
| `admin.test.js` | `GET/POST /api/admin/*` | Admin persona |
| `mcp.test.js` | BFF → token exchange → WebSocket → MCP tool | Full path; requires MCP server running |
| `config.test.js` | `GET /api/config/verticals/list`, `PUT /api/config/vertical` | Vertical switch contract |

### Files that stay mocked (pure logic, no HTTP value)

- `vault/` — crypto, format, CLI, golden tests
- `configStore-*.test.js` — precedence, env coverage
- `tokenUtils.test.js`, `actClaimValidator.test.js` — pure JWT logic
- `delegationChainValidationService.test.js` — pure service logic
- Any test with no `supertest` or `middleware/auth` dependency

---

## Section 5: Bootstrap Verification & Fix Loop

Bootstrap has two layers that tests surface drift in:

| Layer | Source of truth | How tests surface drift |
|---|---|---|
| PingOne provisioning | `pingoneProvisionService.js` | Token exchange fails, wrong `aud`, missing scopes, 401/403 from PingOne |
| Data store bootstrap | `data/bootstrapData.json` | Fixture creation fails, balance assertions wrong, account IDs missing |

### `tests/real/shared/bootstrap.test.js` contract

Runs first. Validates:
1. `GET /api/health` — BFF is up
2. `GET /api/config/verticals/list` — all 6 verticals registered
3. All 6 verticals: `PUT` → `GET` → shape matches `config/verticals/{id}.json`
4. `GET /api/auth/oauth/status` — real session resolves to correct user
5. `GET /api/accounts/my` — demo user has accounts (bootstrapData seeded)
6. Client credentials token — BFF obtains CC token (validates PingOne app + scopes)
7. RFC 8693 exchange — MCP exchanger app + resource server provisioned correctly

### PingOne provisioning fix loop

When a real test fails due to PingOne misconfiguration:
1. Fix identified in test output (wrong scope, bad redirect URI, missing app)
2. Fix applied in `pingoneProvisionService.js` (single source of truth)
3. `npm run pingone:bootstrap:ci` re-runs to apply fix to live environment
4. Re-run failing test to confirm green
5. Entry added to `REGRESSION_PLAN.md §4`

### Data store bootstrap fix loop

When fixture bootstrap fails because `bootstrapData.json` is stale:
1. Fix in-memory state via admin API calls
2. Run `npm run data:export-bootstrap` to snapshot current state
3. Commit updated `bootstrapData.json`

---

## Section 6: Migration Execution Order

### Phase 1 — Shared infrastructure

Build once, unblocks all file migration:

1. `tests/real/helpers/session.js` — headless login + `sessions.db` fallback + skip sentinel
2. `tests/real/helpers/bffClient.js` — axios instance + `setVertical`/`restoreVertical`
3. `tests/real/helpers/fixtures.js` — `bootstrapFixtures(verticalId)` for all 6 verticals
4. `tests/real/helpers/reset.js` — `POST /api/admin/reset-demo` + balance restore
5. `tests/real/helpers/globalSetup.js` — orchestrates session + fixture bootstrap
6. `tests/real/helpers/globalTeardown.js` — restores `banking` vertical, cleans temp files
7. `tests/real/helpers/suiteSetup.js` — `skipIfNoSession()` guard
8. `jest.real.config.js` + new `package.json` scripts
9. `tests/real/shared/health.test.js` — smoke test proving full stack is wired

### Phase 2 — Migration order (highest regression value first)

| Priority | Files | Reason |
|---|---|---|
| 0 | `shared/bootstrap.test.js` | Full provisioning contract — unblocks everything |
| 1 | `shared/oauth-status.test.js` | Auth pipeline — everything depends on sessions |
| 2 | `{vertical}/accounts.test.js` × 6 | Core read path, validates fixtures |
| 3 | `{vertical}/transfers.test.js` × 6 | Write path + real balance mutation |
| 4 | `{vertical}/hitl.test.js` × 6 | Critical security enforcement |
| 5 | `{vertical}/agent.test.js` × 6 | RFC 8693 chain — highest mock debt |
| 6 | `shared/admin.test.js` | Admin persona validation |
| 7 | `shared/mcp.test.js` | Full BFF→MCP path (requires MCP server running) |
| 8 | `{vertical}/vertical.test.js` × 6 | Manifest/terminology shape per vertical |
| 9 | Remaining route files | transactions, config, remaining edge cases |

### Deletion gate

A `src/__tests__/` file is deleted only when:
1. Its `tests/real/` counterpart is green
2. `npm test` (mocked suite) still passes after deletion
3. Entry added to `REGRESSION_PLAN.md §4`

---

## Environment Variables Required

```bash
# Required for headless login (preferred)
PINGONE_TEST_USER=<enduser email>
PINGONE_TEST_PASSWORD=<enduser password>
PINGONE_TEST_ADMIN_USER=<admin email>
PINGONE_TEST_ADMIN_PASSWORD=<admin password>

# Gate — never runs in CI unless explicitly set
RUN_REAL_TESTS=true
```

Fallback to `sessions.db` requires no additional env vars — just a recent login in the running app.

---

## Success Criteria

- `npm run test:real:smoke` passes with BFF running and a valid session
- `npm run test:real` green for all 6 verticals
- `bootstrap.test.js` validates the full provisioning contract end-to-end
- Any PingOne misconfiguration found during testing is fixed in `pingoneProvisionService.js` and re-bootstrapped
- Every migrated file has a `REGRESSION_PLAN.md §4` entry
- Default `npm test` (mocked suite) still passes throughout migration
