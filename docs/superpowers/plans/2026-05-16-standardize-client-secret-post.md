# Plan: Standardize on client_secret_post for all PingOne connections (except worker CC)

> **Review gate.** Touches REGRESSION-sensitive OAuth/token code. Approve before execute.

**Truth being established:** Every PingOne client connection authenticates with `client_secret_post`. The **single exception** is the **Worker Token CC client** (`PINGONE_WORKER_TOKEN_*` / `getAgentClientCredentialsToken[WithExpiry]`), which stays `client_secret_basic`. Introspection uses the **user token** (not the worker), so it standardizes to `post`.

**Why:** This session hit repeated `invalid_client: "Unsupported authentication method"` failures from PingOne because auth methods were inconsistent per-connection (exchanger/gateway/introspection defaulting to `basic` while the PingOne apps expect `post`). Standardizing removes the entire failure class and makes new connections correct by default.

## Verified change set (exact)

### A. Code defaults `'basic'` → `'post'` (NON-worker only)
- `banking_api_server/services/agentMcpTokenService.js:1594` — `aiAgentAuthMethod` default `'basic'` → `'post'`.
- `banking_api_server/services/agentMcpTokenService.js:1595` — `mcpExchangerAuthMethod` default `'basic'` → `'post'`.

### B. Code defaults that MUST NOT change (worker CC — stays basic)
- `banking_api_server/services/oauthService.js:490` — inside `getAgentClientCredentialsToken()` (documented "PingOne Worker Token app"). **LEAVE `'basic'`.**
- `banking_api_server/services/oauthService.js:631` — inside `getAgentClientCredentialsTokenWithExpiry()` (documented "PingOne Worker Token app"). **LEAVE `'basic'`.**
- `banking_api_server/services/mfaService.js:34` — `PINGONE_WORKER_TOKEN_AUTH_METHOD || "basic"` (worker/mgmt). **LEAVE.**
- `banking_api_server/services/pingOneUserService.js:62` — `pingone_mgmt_token_auth_method || 'basic'` (Mgmt worker). **LEAVE.**

### C. `.env` values → `post` (NON-worker)
- `banking_api_server/.env:36` `MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD=basic` → `post`.
- `banking_api_server/.env:74` `PINGONE_INTROSPECTION_AUTH_METHOD=basic` → `post` (introspection uses the user token, not worker).
- `banking_api_server/.env:30` `PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD=post` — already correct (added earlier this session). Keep.

### D. `.env` values that MUST stay basic (worker CC)
- Any `PINGONE_WORKER_TOKEN_AUTH_METHOD` / `PINGONE_MGMT_TOKEN_AUTH_METHOD` — if present, stays `basic`. (Currently not set in `.env`; worker code default is `basic` at oauthService.js:490/631 — left unchanged in B.)

### E. Record the truth
- `ARCHITECTURE-TRUTHS.md` — add an invariant entry: "PingOne client auth method = `client_secret_post` for ALL connections (OAuth, RFC 8693 token exchange, MCP gateway, introspection). The ONLY exception is the Worker Token CC client (`PINGONE_WORKER_TOKEN_*`, Management API), which uses `client_secret_basic`. Code defaults reflect this: non-worker auth-method resolvers default to `'post'`; worker resolvers default to `'basic'`."

## Execution order

1. Edit `agentMcpTokenService.js:1594` and `:1595` (`'basic'` → `'post'`). Syntax-check.
2. Edit `.env:36` and `.env:74` (`basic` → `post`).
3. Add the ARCHITECTURE-TRUTHS.md invariant entry.
4. Restart BFF (`.env` + code reload). Wait healthy.
5. **Verify (live probe):** real customer login → `POST /api/mcp/tool` `get_account_balance` → assert HTTP 200, `tokenEvents` non-empty with an RFC 8693 exchange event, NO `delegation_chain_broken` / `actor_token_invalid` / `[McpExchangerToken] FAILED`.
6. **Verify (worker unbroken):** confirm a worker-token path still works — admin login (uses worker for redirect-uri/app config) succeeds AND introspection at login works. Check BFF log: no new `invalid_client` on the worker path; `[oauth/callback] Session saved OK` for admin.
7. If both green → commit (code + .env? .env is gitignored — confirm; commit code + ARCHITECTURE-TRUTHS.md + a REGRESSION_PLAN §4 entry).

## Verification commands

- Live probe: ephemeral `*.real.spec.js` (customer login + `/api/mcp/tool`), assert status 200 + exchange event. Delete after.
- Worker check: admin login probe (`loginAsAdmin`) → expect `/admin` reached, no `invalid_client` for `PINGONE_WORKER` in `/tmp/bank-api-server.log`.
- Regression: `cd banking_api_server && OLLAMA_BASE_URL= npx jest oauthStatus hitlRoute tokenExchange 2>&1 | grep -E "Tests:|✕"` — no new failures vs baseline.

## Rollback

Single-purpose: revert the 2 code lines + 2 `.env` lines + the ARCHITECTURE-TRUTHS entry. No schema/format change. Worker path untouched, so rollback risk is low.

## Blast radius / do-not-break

- Worker CC token path (`oauthService.js:474/615`, `mfaService.js`, `pingOneUserService.js`) is **explicitly excluded** — those defaults stay `basic`. PingOne Management API + redirect-uri-guard depend on the worker token; changing it would break admin login & app-config reads.
- `.env` is gitignored — the `.env` changes are operational (this machine); the durable truth is the code defaults + ARCHITECTURE-TRUTHS.md, so a fresh clone/bootstrap inherits `post` by default.
- This is additive to the chip deliverable; it does not modify any chip/test file.
