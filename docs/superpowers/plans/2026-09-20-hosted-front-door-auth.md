# Hosted PingOne Front-Door Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate PingOne admission session for the hosted browser surface while preserving the existing Demo User/Admin OAuth sessions and demo accounts.

**Architecture:** A dedicated signed `hosted.sid` cookie and store-backed session adapter will carry only front-door approval. The existing `connect.sid` express-session session continues to carry Demo User/Admin identity and tokens. NGINX external auth and the BFF API gate require the hosted session; existing application OAuth routes remain responsible for application login after admission.

**Tech Stack:** Node 22+, CommonJS, Express 4, express-session, LMDB session store, Jest 29, Kubernetes NGINX ingress, PingOne OIDC Authorization Code + PKCE.

**Spec:** `docs/superpowers/specs/2026-09-20-hosted-front-door-auth-design.md`

## Global Constraints

- Preserve OAuth admin/user state, nonce, PKCE, issuer, signature, audience, expiry, redirect-origin, role resolution, and session-regeneration behavior.
- Keep the BFF as the only browser-token custodian; the front-door session stores no access or refresh tokens.
- Use exact normalized email-domain matching and require `email_verified === true` when the hosted gate is enabled.
- Local Docker/Kubernetes developer flows remain gate-off by default.
- Only exact front-door login/callback routes bypass ingress auth; existing application OAuth routes are not front-door bypasses.
- Keep public MCP ingress content unchanged.
- Respect `REGRESSION_PLAN.md` §0–§1 and the emoji allowlist.
- Stage only intended files and verify on the isolated branch before claiming completion.

---

### Task 1: Add dedicated front-door configuration and session adapter

**Files:**
- Create: `demo_api_server/config/hostedAccess.js`
- Create: `demo_api_server/middleware/hostedSession.js`
- Modify: `demo_api_server/server.js:494-524, 662-669`
- Test: `demo_api_server/src/__tests__/hostedSession.test.js`

**Interfaces:**
- `config/hostedAccess.js` exports lazy configuration for `HOSTED_ACCESS_CLIENT_ID`, `HOSTED_ACCESS_CLIENT_SECRET`, `HOSTED_ACCESS_REDIRECT_URI`, hosted OIDC scopes, and a dedicated cookie name.
- `middleware/hostedSession.js` exports `createHostedSessionMiddleware({ store, secret, production })`, which loads a signed, store-backed session under `req.hostedSession` without mounting a second express-session response hook.
- `middleware/hostedSession.js` exports `saveHostedSession(req, callback)` and `destroyHostedSession(req, callback)` for explicit callback-safe persistence.

- [ ] **Step 1: Write the failing session-isolation tests.**

```js
test('loads front-door session separately from the application session', async () => {
  const request = agent.get('/api/auth/hosted-access/check');
  // Seed only the normal application session and assert the hosted check remains 401.
  // Seed only the hosted session and assert the application session remains unauthenticated.
});

test('front-door cookie uses a distinct name and secure HTTP-only attributes', () => {
  const middleware = createHostedSessionMiddleware({ store, secret: 'test-secret', production: true });
  expect(middleware.cookieName).toBe('hosted.sid');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because no hosted session exists.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedSession.test.js --forceExit`

Expected: FAIL on the missing hosted-session middleware/interface, not on test discovery.

- [ ] **Step 3: Implement the store-backed hosted session adapter.**

Use the existing `sessionStore`, a `SESSION_SECRET`-derived signing secret, `httpOnly`, `secure`, `sameSite`, and a 24-hour lifetime. Sign a random hosted session ID in a `hosted.sid` cookie. Load and save only the hosted session record through the generic store interface; never replace `req.session` and never store OAuth tokens in the hosted record.

- [ ] **Step 4: Mount hosted session loading before the hosted routes and gate.**

Keep `app.use(sessionMiddleware)` and all existing application session behavior unchanged. Mount the hosted-session wrapper after the application session and before `restoreSessionFromCookie`, hosted routes, and `createHostedAccessGate()` so both sessions are available during admission checks.

- [ ] **Step 5: Run the focused session tests and commit.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedSession.test.js --forceExit`

Commit: `git add demo_api_server/config/hostedAccess.js demo_api_server/middleware/hostedSession.js demo_api_server/server.js demo_api_server/src/__tests__/hostedSession.test.js && git commit -m "feat(auth): isolate hosted admission session"`

---

### Task 2: Implement the dedicated PingOne front-door OAuth flow

**Files:**
- Create: `demo_api_server/services/hostedAccessOAuthService.js`
- Modify: `demo_api_server/routes/hostedAccess.js`
- Modify: `demo_api_server/services/authAccessAuditService.js` only if a flow identifier is required by existing audit helpers
- Test: `demo_api_server/src/__tests__/hostedAccessOAuth.test.js`

**Interfaces:**
- `hostedAccessOAuthService.generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce })` returns the PingOne authorization URL using the dedicated client and `openid profile email`.
- `hostedAccessOAuthService.exchangeCodeForToken(code, verifier, redirectUri)` returns the token response without exposing it to the browser or storing it in `req.session`.
- `hostedAccessOAuthService.validateIdentity(tokenData)` returns the merged ID-token/UserInfo claims needed by `evaluateHostedIdentity`.
- `routes/hostedAccess.js` owns `GET /login`, `GET /callback`, `GET /check`, and `GET /logout` under `/api/auth/hosted-access`.

- [ ] **Step 1: Add failing route tests for front-door-only admission.**

Cover these behaviors independently:

```js
test('front-door callback stamps hosted approval without creating an app user or app tokens', async () => {
  // Mock only the PingOne exchange/userinfo boundary; assert req.session.user and
  // req.session.oauthTokens remain absent while req.hostedSession has approval.
});

test('front-door callback rejects missing, unverified, and disallowed identities', async () => {
  // Assert 403 minimal response and no application-session mutation for each claim set.
});

test('front-door logout destroys only hosted session state', async () => {
  // Seed both sessions; logout; assert hosted check is 401 while app session remains.
});
```

- [ ] **Step 2: Run the focused tests and confirm the new flow fails.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessOAuth.test.js --forceExit`

Expected: FAIL because the dedicated routes/service are not implemented.

- [ ] **Step 3: Implement state, PKCE, nonce, and redirect handling in the hosted service.**

Use a hosted-session state/verifier/nonce namespace, never the application OAuth namespace. Sanitize `return_to` with the existing same-origin helper. Use the configured hosted redirect URI and reject origin mismatches.

- [ ] **Step 4: Implement the callback validation and approval persistence.**

After existing PingOne token/ID-token validation, merge claims with UserInfo using the existing coherent-claims policy. Evaluate the hosted identity. On success, stamp only `req.hostedSession.hostedAccessApproval`, save that session, and redirect to the sanitized return path. On denial or failure, destroy partial hosted state, clear only hosted cookies, emit the appropriate audit terminal event, and return the minimal restricted response.

- [ ] **Step 5: Implement check and logout.**

`/check` must inspect only `req.hostedSession` and return `204`, `401`, or `403`. `/logout` must destroy the hosted session, clear `hosted.sid`, and leave `connect.sid`, `_auth`, and demo tokens untouched.

- [ ] **Step 6: Run focused OAuth tests and commit.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessOAuth.test.js src/__tests__/hostedAccessPolicy.test.js src/__tests__/authAccessAuditService.test.js --forceExit`

Commit: `git add demo_api_server/services/hostedAccessOAuthService.js demo_api_server/routes/hostedAccess.js demo_api_server/services/authAccessAuditService.js demo_api_server/src/__tests__/hostedAccessOAuth.test.js && git commit -m "feat(auth): add PingOne hosted front-door flow"`

---

### Task 3: Make the BFF gate require front-door approval only

**Files:**
- Modify: `demo_api_server/middleware/hostedAccessGate.js`
- Modify: `demo_api_server/routes/hostedAccess.js`
- Modify: `demo_api_server/server.js`
- Test: `demo_api_server/src/__tests__/hostedAccessGate.test.js`

**Interfaces:**
- `hasCurrentHostedAccessApproval(req.hostedSession, policy)` is the only admission predicate when the gate is enabled.
- Existing `req.session.user`, `req.session.oauthTokens`, and `req.session.oauthType` are not consulted by the hosted gate.

- [ ] **Step 1: Add failing gate tests proving application-login independence.**

```js
test('application session alone cannot satisfy the hosted gate', () => {
  const req = { session: { user: { id: 'demo-user' } }, hostedSession: {} };
  expect(runGate(req)).toHaveStatus(401);
});

test('hosted approval permits requests even before Demo User login', () => {
  const req = { session: {}, hostedSession: { hostedAccessApproval: currentApproval } };
  expect(runGate(req)).toCallNext();
});
```

- [ ] **Step 2: Run the gate tests and confirm the current session-coupled behavior fails.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js --forceExit`

- [ ] **Step 3: Switch the gate and check endpoint to `req.hostedSession`.**

Preserve gate-disabled no-op behavior, exact path matching, no-store headers, minimal denial behavior, and direct-BFF defense in depth. Do not add existing app OAuth routes to the hosted bypass list.

- [ ] **Step 4: Update existing hosted-access route tests.**

Change fixtures so application OAuth tests explicitly seed hosted approval where the request is intended to pass. Add assertions that application login remains available after front-door approval and that an application user is not required merely to load the SPA.

- [ ] **Step 5: Run the focused gate and existing hosted-access suites.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js --forceExit`

Commit: `git add demo_api_server/middleware/hostedAccessGate.js demo_api_server/routes/hostedAccess.js demo_api_server/server.js demo_api_server/src/__tests__/hostedAccessGate.test.js demo_api_server/src/__tests__/oauthUser.hostedAccess.test.js demo_api_server/src/__tests__/oauth.hostedAccess.test.js && git commit -m "feat(auth): gate hosted app with front-door session"`

---

### Task 4: Wire SE Kubernetes ingress and deployment configuration

**Files:**
- Modify: `k8s/aws/se-ingress.yaml`
- Modify: `k8s/aws/deploy.sh`
- Modify: `scripts/check-hosted-access-ingress.js`
- Modify: `scripts/check-hosted-access-ingress.test.js`
- Modify: `k8s/README.md` hosted access section

**Interfaces:**
- `auth-signin` targets `/api/auth/hosted-access/login?return_to=$escaped_request_uri`.
- The bypass ingress contains only exact hosted login/callback routes and no `auth-url`.
- SE deployment supplies `HOSTED_ACCESS_CLIENT_ID`, `HOSTED_ACCESS_CLIENT_SECRET`, and `HOSTED_ACCESS_REDIRECT_URI` through the deployment secret/config path without committing values.

- [ ] **Step 1: Add failing static ingress assertions.**

Assert the sign-in path is hosted-specific, the bypass contains only exact hosted routes, existing Demo User/Admin paths are absent from the ingress bypass, and the public MCP ingress remains byte-for-byte unchanged.

- [ ] **Step 2: Run the static test and confirm it fails against the current ingress.**

Run: `node --test scripts/check-hosted-access-ingress.test.js`

- [ ] **Step 3: Change the SE ingress redirect and exact bypass.**

Keep the catch-all `/` and `/grafana` external-auth annotations unchanged. Add exact `GET` routes for hosted login, hosted callback, and hosted logout only if logout must be reachable after admission. Do not expose broad `/api/auth/hosted-access` prefixes.

- [ ] **Step 4: Add deployment configuration and restart behavior.**

Add non-secret client ID/redirect configuration to the generated/hand-managed configuration source and secret client secret to the existing secret workflow. Ensure ConfigMap/Secret changes restart the BFF so the hosted OAuth settings are loaded. Keep local Kubernetes gate-off defaults intact.

- [ ] **Step 5: Run static verification and commit.**

Run: `node --test scripts/check-hosted-access-ingress.test.js && npm run hosted-access:verify`

Commit: `git add k8s/aws/se-ingress.yaml k8s/aws/deploy.sh scripts/check-hosted-access-ingress.js scripts/check-hosted-access-ingress.test.js k8s/README.md && git commit -m "feat(k8s): route hosted access through front door"`

---

### Task 5: Preserve and verify existing application login behavior

**Files:**
- Modify only if required by test fixtures: `demo_api_server/src/__tests__/oauthUser.hostedAccess.test.js`, `demo_api_server/src/__tests__/oauth.hostedAccess.test.js`
- Test: existing focused BFF suites and a new two-layer integration characterization test under `demo_api_server/src/__tests__/hostedFrontDoor.integration.test.js`

- [ ] **Step 1: Add the two-layer characterization test.**

Exercise the sequence: no hosted session → denied; hosted session only → SPA/perimeter allowed; hosted session plus Demo User login → normal application API allowed; Demo User logout → perimeter remains; hosted logout → perimeter denied while application-session fixture remains unchanged.

- [ ] **Step 2: Run the characterization test and fix only contract violations.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedFrontDoor.integration.test.js --forceExit`

- [ ] **Step 3: Run all affected server suites.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedSession.test.js src/__tests__/hostedAccessOAuth.test.js src/__tests__/hostedAccessGate.test.js src/__tests__/hostedAccessPolicy.test.js src/__tests__/authAccessAuditService.test.js src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js src/__tests__/hostedFrontDoor.integration.test.js --forceExit`

- [ ] **Step 4: Run repository verification.**

Run: `npm run hosted-access:verify && npm run authz:verify && npm run topology:verify`

- [ ] **Step 5: Commit the final test/fixture changes.**

Commit: `git add demo_api_server/src/__tests__ && git commit -m "test(auth): verify independent hosted and app sessions"`

---

### Task 6: Final verification and handoff

**Files:**
- No new production files; inspect all changed paths and the final diff.

- [ ] **Step 1: Run focused BFF verification again from the final branch.**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedSession.test.js src/__tests__/hostedAccessOAuth.test.js src/__tests__/hostedAccessGate.test.js src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js --forceExit`

- [ ] **Step 2: Run shell/static checks.**

Run: `node --test scripts/check-hosted-access-ingress.test.js && npm run hosted-access:verify && bash -n k8s/aws/deploy.sh`

- [ ] **Step 3: Inspect changed files and staged paths.**

Run: `git diff --check && git status --short && git diff main...HEAD --stat`

Confirm the unrelated main-checkout change in `pingone-privgateway-helm-main/agentless/sidecars.values.yaml` is not present in this branch.

- [ ] **Step 4: Report deployment prerequisites without applying live changes.**

Document that a PingOne administrator must create/configure the dedicated front-door OIDC client and provide its client ID/secret through the deployment secret workflow. Do not deploy to the remote SE cluster unless separately requested.
