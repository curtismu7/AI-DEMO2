# User API Key & Secrets Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only User API Key & Secrets tab that saves the two Privilege user API credentials to the encrypted vault and runs the sample token-generation/users-list flow through the BFF.

**Architecture:** Keep all vault access, OpenSSL-compatible encryption/decryption, JWT handling, and Privilege HTTP calls in the BFF. Add a dedicated fixed-purpose route and panel inside the existing Privilege MCP client, with command previews that contain placeholders and only masked result previews. Explicitly keep these API calls and the user-list response out of the existing browser traffic-history persistence path.

**Tech Stack:** Node.js 22, Express, Node `crypto`, the existing encrypted vault library and `configStore`, React, Axios, Vitest, Jest.

**Spec:** [2026-09-29-user-api-key-secrets-tab-design.md](../specs/2026-09-29-user-api-key-secrets-tab-design.md)

## Global Constraints

- Before implementation, read `REGRESSION_PLAN.md` sections 0–1 and invoke `regression-guard`, as required for `demo_api_ui/`, authorization, and token-exchange changes.
- Use the existing isolated worktree at `.worktrees/user-api-key-secrets-design`; stage only paths named for the task being committed. Never run `docker compose` from the worktree.
- Read the nearest `CLAUDE.md` files for `demo_api_server/` and `demo_api_ui/` before editing those services.
- Keep API key and secret reads vault-provenance-only. Neither environment variables nor LMDB may supply either value. Save only the fixed entries `PRIVILEGE_USER_API_KEY` and `PRIVILEGE_USER_API_SECRET`.
- Never log or return raw credentials, vault passwords, encrypted token payloads, Authorization headers, or JWTs. The BFF returns a masked JWT preview only. The complete users response is rendered in current page state and is not persisted in API traffic history or browser storage.
- Use fixed outbound paths and an HTTPS server-configured base URL. The browser supplies only Environment ID and User ID; it cannot select a host, path, method, or request body.
- Preserve the existing Agent Privilege client behavior and project emoji allowlist. The new tab is a demo-mode tab, alongside Agent Chat and Tools.
- Follow test-first steps in each implementation task. Do not use live Privilege credentials or call the external service in automated tests; inject a deterministic fetch stub.
- After each implementation task, stage only its listed paths and create a focused commit. Do not stage `secrets.vault`, audit logs, `.env`, temp files, or unrelated changes.

## File Structure Map

| Path | Change | Responsibility |
| --- | --- | --- |
| `demo_api_server/services/configStore.js` | Modify | Add a vault-provenance-only value accessor for the two credentials. |
| `demo_api_server/services/privilegeUserApiKeyVaultService.js` | Add | Read masked vault status and atomically update only the two fixed vault entries, refreshing in-memory cache with `persist:false`. |
| `demo_api_server/services/privilegeUserApiKeyService.js` | Add | Match the Go sample's encryption envelope, token request, response decryption/nonce check, and fixed users-list request. |
| `demo_api_server/routes/privilegeUserApiKeys.js` | Add | Admin-authenticated status, save, and run endpoints with bounded input and sanitized errors. |
| `demo_api_server/server.js` | Modify | Mount the dedicated router at `/api/privilege-user-api-keys`. |
| `demo_api_server/middleware/activityLogger.js` | Modify | Redact API key, API secret, and vault-password request fields before activity capture. |
| `demo_api_server/services/apiCallTrackerService.js` | Modify | Extend recursive request/response body redaction for these credential field names. |
| `demo_api_server/tests/services/privilegeUserApiKeyService.test.js` | Add | Deterministic crypto compatibility, nonce, HTTP path, status, and short-circuit tests. |
| `demo_api_server/tests/services/privilegeUserApiKeyVaultService.test.js` | Add | Vault-only reads, fixed-key writes, independent replacement, atomic failure behavior, cache refresh, and masking tests. |
| `demo_api_server/tests/routes/privilegeUserApiKeys.test.js` | Add | Route auth/admin/CSRF, validation, response safety, and flow-stage tests. |
| `demo_api_server/tests/middleware/activityLogger.privilegeUserApiKeys.test.js` | Add | Activity request-body redaction regression coverage. |
| `demo_api_server/tests/services/apiCallTrackerService.privilegeUserApiKeys.test.js` | Add | Recursive tracker redaction regression coverage. |
| `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` | Modify | Add a third demo tab and render its panel. |
| `demo_api_ui/src/pages/PrivilegeMcpClientPage.css` | Modify | Style the new panel consistently with the existing client. |
| `demo_api_ui/src/components/privilege/PrivilegeUserApiKeysPanel.jsx` | Add | Environment/User inputs, vault editor, four command previews, run progress, and ephemeral users output. |
| `demo_api_ui/src/services/apiClient.js` | Modify | Support a per-request opt-out from API traffic capture for sensitive feature calls. |
| `demo_api_ui/src/services/apiTrafficStore.js` | Modify | Redact credential field names if encountered by any caller. |
| `demo_api_ui/src/services/__tests__/apiTrafficStore.privilegeUserApiKeys.test.js` | Add | Verify credential-field redaction. |
| `demo_api_ui/src/services/__tests__/apiClient.privilegeUserApiKeys.test.js` | Add | Verify opt-out suppresses both request and response traffic persistence. |
| `demo_api_ui/src/components/privilege/__tests__/PrivilegeUserApiKeysPanel.test.jsx` | Add | Verify tab content, blank/cleared secret inputs, masked previews, statuses, errors, and ephemeral result rendering. |
| `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.viewMode.test.jsx` | Modify | Update the demo-tab expectation to include User API Key & Secrets. |

## Implementation Tasks

### Task 1: Run the required authorization/token-flow regression gate

**Files:** no implementation files.

- [ ] Read `REGRESSION_PLAN.md` sections 0–1 and run the repository's `regression-guard` before editing any service or UI code.
- [ ] Recheck the Go sample and PDF for field names, payload nesting, crypto envelope/derivation details, endpoints, headers, TTL, and namespace. Keep any fixture values synthetic.
- [ ] Record the concrete guard result in this plan's SDD progress ledger; do not begin code until the guard permits the feature.

### Task 2: Add sensitive-field redaction and traffic-capture opt-out

**Files:**

- Modify `demo_api_server/middleware/activityLogger.js`.
- Modify `demo_api_server/services/apiCallTrackerService.js`.
- Add `demo_api_server/tests/middleware/activityLogger.privilegeUserApiKeys.test.js`.
- Add `demo_api_server/tests/services/apiCallTrackerService.privilegeUserApiKeys.test.js`.
- Modify `demo_api_ui/src/services/apiTrafficStore.js`.
- Modify `demo_api_ui/src/services/apiClient.js`.
- Add `demo_api_ui/src/services/__tests__/apiTrafficStore.privilegeUserApiKeys.test.js`.
- Add `demo_api_ui/src/services/__tests__/apiClient.privilegeUserApiKeys.test.js`.

- [ ] Write failing tests first. Cover case-insensitive/nested redaction of `api_key`, `api_secret`, camel-case `apiKey`/`apiSecret`, `current_password`, and `currentPassword` in BFF activity logs, BFF API tracker formatting, and browser `redactBody`.
- [ ] Add a per-request `_skipTrafficCapture: true` flag to the API client. Both successful and failed request interceptors must skip appending entries when it is set; the default behavior for all existing calls must remain unchanged.
- [ ] Test that an opted-out request persists neither its credential-bearing request body nor its potentially sensitive response body to the in-memory ring buffer or localStorage, while a normal request still records traffic.
- [ ] Run the new focused tests and confirm they fail before implementation and pass after implementation:

  ```bash
  (cd demo_api_server && CI=true npx jest tests/middleware/activityLogger.privilegeUserApiKeys.test.js tests/services/apiCallTrackerService.privilegeUserApiKeys.test.js --runInBand --forceExit)
  (cd demo_api_ui && npx vitest run src/services/__tests__/apiTrafficStore.privilegeUserApiKeys.test.js src/services/__tests__/apiClient.privilegeUserApiKeys.test.js)
  ```

- [ ] Commit only the eight implementation/test files listed above with message `fix: redact privilege user api credentials from traffic`.

### Task 3: Add strict vault reads and fixed-key credential saves

**Files:**

- Modify `demo_api_server/services/configStore.js`.
- Add `demo_api_server/services/privilegeUserApiKeyVaultService.js`.
- Add `demo_api_server/tests/services/privilegeUserApiKeyVaultService.test.js`.

- [ ] Write failing tests first for a new accessor with signature `getVaultValue(name)`. It returns a non-empty cached value only when `_provenance[name.toUpperCase()] === 'vault'`; it returns `null` for environment-only/LMDB-only values even when `getEffective(name)` would resolve them.
- [ ] Test the vault service API:

  ```js
  getPrivilegeUserApiKeyStatus({ configStore, baseUrl })
  savePrivilegeUserApiCredentials({ apiKey, apiSecret, password, configStore, vaultLib, vaultPath, logger })
  ```

- [ ] Cover these cases: status returns booleans, masked previews, missing entry names, and the effective controller URL without raw values; both-empty save rejects before opening the vault; one-field replacement leaves the other stored value intact; only the two constant entry names can be written; wrong password or save failure updates neither the in-memory cache nor reported previews; successful save closes the vault handle and refreshes only updated cache keys through `configStore.setRaw(updates, { persist: false })`.
- [ ] Implement vault writes with `openVault(vaultPath, password, { caller: 'privilegeUserApiKeyVaultService' })`, `vault.set`, `await vault.save()`, a `finally` close, and no retained password. Do not call a generic vault CRUD API or accept entry names/path from the request.
- [ ] Keep `getVaultValue` strict and separate from `getEffective`; no environment or LMDB fallback is allowed for these two keys.
- [ ] Run the focused vault tests:

  ```bash
  cd demo_api_server && CI=true npx jest tests/services/privilegeUserApiKeyVaultService.test.js --runInBand --forceExit
  ```

- [ ] Commit only the three listed files with message `feat: save privilege user api credentials to vault`.

### Task 4: Implement the Go-compatible token exchange and users request

**Files:**

- Add `demo_api_server/services/privilegeUserApiKeyService.js`.
- Add `demo_api_server/tests/services/privilegeUserApiKeyService.test.js`.

- [ ] Write failing unit tests first for exported functions with signatures:

  ```js
  encryptAppUserTokenRequest({ environmentId, userId, apiKey, apiSecret, now, randomBytes })
  decryptAppUserTokenResponse({ encResData, apiSecret, expectedNonce })
  runPrivilegeUserApiKeyFlow({ environmentId, userId, apiKey, apiSecret, baseUrl, fetchImpl, now, randomBytes, timeoutMs })
  ```

- [ ] Build synthetic known-answer fixtures from the supplied Go implementation. Verify field names, PBKDF2-SHA256 with 10,000 iterations, AES-256-CBC, byte order/encoding, and OpenSSL-compatible envelope; verify encrypt/decrypt round-trip, malformed ciphertext rejection, and echoed-nonce mismatch rejection.
- [ ] Stub `fetchImpl` and assert the exact fixed requests: POST `/pubapi/{environmentId}/v1/appusertoken` with PDF metadata, fresh request session UUID, and the expected encrypted data; then GET `/api/{environmentId}/v1/users` with the decrypted JWT bearer and a different fresh session UUID. Assert the base URL must be HTTPS and comes only from server configuration, and both requests set `redirect: 'error'` so credentials never follow an upstream redirect.
- [ ] Cover token endpoint non-2xx, invalid response shape, decrypt failure, nonce mismatch, users `401`, other users non-2xx, timeout, and TLS/network errors. Every failure must stop at its stage and return a sanitized diagnostic without request bodies, credentials, encrypted data, or JWT.
- [ ] Implement fresh 32-byte nonce material and timestamp per run, namespace `default`, TTL `3600`, safe timeout handling, and the exact Go/PDF request format. Do not log inputs, headers, ciphertext, response bodies from token generation, or raw JWT.
- [ ] Return only stage progress, Privilege HTTP status, users JSON on success, and a masked JWT preview. Keep the raw JWT local to the single BFF request while issuing the users call.
- [ ] Run the focused service tests:

  ```bash
  cd demo_api_server && CI=true npx jest tests/services/privilegeUserApiKeyService.test.js --runInBand --forceExit
  ```

- [ ] Commit only the two listed files with message `feat: implement privilege user api token flow`.

### Task 5: Expose fixed-purpose admin routes

**Files:**

- Add `demo_api_server/routes/privilegeUserApiKeys.js`.
- Modify `demo_api_server/server.js`.
- Add `demo_api_server/tests/routes/privilegeUserApiKeys.test.js`.

- [ ] Write route tests first for:

  - `GET /api/privilege-user-api-keys/status`
  - `POST /api/privilege-user-api-keys/credentials` with `{ api_key, api_secret, current_password }`
  - `POST /api/privilege-user-api-keys/run` with `{ environment_id, user_id }`

- [ ] Assert unauthenticated and non-admin callers are rejected; save/run reject requests missing `x-privilege-user-api-csrf`; status reveals only presence, masked previews, required names, and base URL; credential POST accepts no arbitrary vault names/path; run rejects malformed Environment ID/User ID UUIDs and ignores/rejects any browser-supplied host/path/method/body override.
- [ ] Assert both-empty save is rejected, save password failures are sanitized and do not start network traffic, and token/decryption/nonce failures never call the users endpoint.
- [ ] Assert route responses contain no raw API key, API secret, current vault password, encrypted payload, Authorization header, or complete JWT. Success may include the users response and only a masked JWT preview. Do not register this feature with `apiCallTrackerService`.
- [ ] Implement router-wide `authenticateToken` and `requireAdmin`; use a custom-header CSRF guard on both POST endpoints. Mount the router at `/api/privilege-user-api-keys` in `server.js`. Validate bounded UUID strings before handing values to the service and sanitize every caught error.
- [ ] Run the focused route tests:

  ```bash
  cd demo_api_server && CI=true npx jest tests/routes/privilegeUserApiKeys.test.js --runInBand --forceExit
  ```

- [ ] Commit only the three listed files with message `feat: add admin privilege user api routes`.

### Task 6: Add the User API Key & Secrets client tab

**Files:**

- Add `demo_api_ui/src/components/privilege/PrivilegeUserApiKeysPanel.jsx`.
- Add `demo_api_ui/src/components/privilege/__tests__/PrivilegeUserApiKeysPanel.test.jsx`.
- Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`.
- Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`.
- Modify `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.viewMode.test.jsx` to keep the existing demo-tab regression assertion current.

- [ ] Write component tests first for the exact tab title and placement, status load, blank password inputs, no prefilled key/secret, independent replacement, successful/failed save clearing behavior, redacted previews, all four command stages, run progress, users response rendering, UUID validation, sanitized failure messages, and no reveal control.
- [ ] Add the tab key/label to the existing demo `VIEW_TABS` and `TAB_LABELS`, render the new panel when selected, and leave inspect tabs and Agent Chat/Tools behavior intact.
- [ ] The panel makes all calls through the existing authenticated Axios client with `_skipTrafficCapture: true`; add `x-privilege-user-api-csrf: 1` to save/run requests. It never writes inputs, JWT, result JSON, or credentials to local/session storage.
- [ ] Present Environment ID and User ID fields, vault status, blank API key/API secret/current vault password fields, Save to Vault, and one Run token and list users action. Clear all save fields after every attempt, show only BFF masked previews, and store results only in React state.
- [ ] Render the four numbered Go/cURL command shapes from the PDF with dynamic values replaced by masked placeholders. Show progress for encryption, token request, decryption, and users list; display HTTP status and users JSON without exposing raw JWT.
- [ ] Add page-scoped styles that follow existing `cur-*` controls and preserve the repository emoji allowlist.
- [ ] Run the focused component, page view-mode, and API-client tests:

  ```bash
  cd demo_api_ui && npx vitest run src/components/privilege/__tests__/PrivilegeUserApiKeysPanel.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.viewMode.test.jsx src/services/__tests__/apiTrafficStore.privilegeUserApiKeys.test.js src/services/__tests__/apiClient.privilegeUserApiKeys.test.js
  ```

- [ ] Commit only the five listed files with message `feat: add user api key and secrets tab`.

### Task 7: Run required focused verification and review the final diff

**Files:** no planned source changes; fix issues in their owning task and keep fixes in a separate focused commit.

- [ ] Ensure each service's dependencies are installed with its `npm ci` before testing; do not let `npx` fetch an undeclared toolchain.
- [ ] Run all new and directly affected BFF tests together:

  ```bash
  (cd demo_api_server && CI=true npx jest tests/services/privilegeUserApiKeyService.test.js tests/services/privilegeUserApiKeyVaultService.test.js tests/routes/privilegeUserApiKeys.test.js tests/middleware/activityLogger.privilegeUserApiKeys.test.js tests/services/apiCallTrackerService.privilegeUserApiKeys.test.js --runInBand --forceExit)
  ```

- [ ] Run all directly affected UI tests and the required production build:

  ```bash
  (cd demo_api_ui && npx vitest run src/components/privilege/__tests__/PrivilegeUserApiKeysPanel.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.viewMode.test.jsx src/services/__tests__/apiTrafficStore.privilegeUserApiKeys.test.js src/services/__tests__/apiClient.privilegeUserApiKeys.test.js)
  (cd demo_api_ui && npm run build)
  ```

- [ ] Run repository unit/authz checks required by the root instructions:

  ```bash
  ./run-tests.sh unit
  npm run authz:verify
  ```

- [ ] Run the `THEMING.md` §1.4 contrast auditor for the touched page in both light and dark themes; verify keyboard focus and narrow-screen layout while reviewing the page.

- [ ] Review `git diff --check`, `git status --short`, and the full feature diff. Confirm `secrets.vault`, `.env`, audit logs, test output, and temporary files are not staged; confirm no credentials or complete JWT appear in tracked files or output.
- [ ] Report the actual focused test/build/authz results and any external-service limitation. Do not claim the live Privilege call succeeded unless an operator explicitly runs it against the configured environment.

## Spec Coverage Self-Review

| Approved requirement | Planned tasks |
| --- | --- |
| Vault-only reads and fixed-entry admin save | Tasks 3 and 5 |
| Go-compatible crypto, nonce verification, fixed token and users endpoints | Tasks 1 and 4 |
| Authenticated administrator access and CSRF on writes | Task 5 |
| Masking and redaction through BFF and browser traffic surfaces | Tasks 2, 4, 5, and 6 |
| Fixed command previews and one-run action in the new tab | Task 6 |
| UUID checks, sanitized errors, run-stage reporting, users JSON | Tasks 4, 5, and 6 |
| No browser persistence of credentials, JWT, or users results | Tasks 2 and 6 |
| Required regression guard, focused checks, UI build, and authz verification | Tasks 1 and 7 |

There are no `TODO`, `TBD`, placeholder implementation decisions, or unresolved type/signature references in this plan. External values in the UI are placeholders by design and are never live secrets.
