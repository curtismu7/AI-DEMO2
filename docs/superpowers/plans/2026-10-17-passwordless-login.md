# Passwordless Sign-in (Passkey or CIBA Approval Link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers and admins sign in with no password on PingOne and PingFederate, by passkey or by approving an emailed/texted link, using app-initiated CIBA.

**Architecture:** The sign-in modal gains two buttons. The link button asks for a username/email and a channel, starts a CIBA request through new BFF login routes, shows a match code, and polls. On approval the BFF builds the same session the authorization-code `/callback` builds today, from a shared `establishUserSession` / `establishAdminSession` function extracted from the two callbacks. PingFederate uses the same routes against PF `bc-auth.ciba`, with the out-of-band plugin bridged to the PingOne email/text approval.

**Tech Stack:** Node/Express BFF (`demo_api_server`), React SPA (`demo_api_ui`), jest (server) + vitest (UI), PingOne CIBA + DaVinci (already deployed), PingFederate Java OOB plugin (`scripts/pingfederate/plugins/ai-agent-ciba-approver`).

**Spec:** `docs/superpowers/specs/2026-10-17-passwordless-login-design.md`

## Global Constraints

- PingOne `binding_message` max 8 characters: first 2 = vertical code (`config/cibaVerticalCodes.js`), last 6 = hex match code. CIBA request lifetime 120 s, poll interval 2 s.
- Both channels (email, text) are always offered; the answer to "start" is identical for known and unknown users (no account-existence leak).
- Admin: a link or a passkey alone is enough. A password break-glass path stays reachable ("use a password instead" link + the plain redirect login).
- Policy/app changes are additive only (nothing removed or reordered). Live PingOne/PF changes go through scripts that dry-run by default, back up first, and read back.
- Existing fallback stays: anything the modal cannot finish returns `{fallback:true}` and the SPA starts the ordinary redirect login.
- Flow: worktree → PR → owner merges (`gh pr merge` is classifier-blocked; hand the owner the command) → focused deploy per service (`kubectl set image`, verify pod digest). DaVinci edits are drafts a person deploys.
- Match-code wording and branding must equal CIBA step-up ("Nothing to type… same code shown in the app").

## Review Focus

Failure modes the spec implies but no feature task would otherwise test (each gets a test in the owning task):

1. Unknown user / user lacking the chosen channel: `login/start` answers exactly as for a real user; `poll` stays `pending` then `expired`, never `approved`. (Task 4)
2. Approval for the wrong person: the CIBA ID token `sub` differs from the identified user → no session is created. (Task 4)
3. Prompt-bombing: repeated `login/start` for one identifier or one IP is rate-limited and sends at most one message per window. (Task 4)
4. Session fixation / replay: session id is regenerated on success; an `authReqId` can establish a session once; an expired or foreign-session id never can. (Task 4)
5. Admin lockout: after the change the demo admin can still sign in by passkey, by link, and by the password path. (Task 7 gate)

---

## Milestone 0 — Re-verify the sign-in fix (no code)

### Task 0: Confirm the SMS-to-password bug is fixed on main

**Files:** none. Result recorded in the PR description of Task 1.

- [ ] **Step 1:** On `origin/main`, run the existing suites that cover the fix: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/mfaTest.pfUserLink.test.js` and `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx`. Expected: all pass (PRs #1467, #1468, #1470).
- [ ] **Step 2:** Ask the owner to confirm one device-first SMS sign-in on the hosted site now works (the other session already live-verified it). If it fails, stop and diagnose before Task 1.

---

## Milestone 1 — Spike: can CIBA give a login session?

### Task 1: CIBA-login spike and decision record

**Files:**
- Create: `scripts/spike-ciba-login.mjs`
- Create: `docs/superpowers/specs/2026-10-17-ciba-login-spike-result.md`

**Interfaces:**
- Produces: a written decision, either **R1** (CIBA grant directly on the User Login / Admin Login apps) or **R2** (token exchange of a CIBA token for a login-audience token via the existing token-exchanger client), or **R3** (fall back to the DaVinci login flow). Tasks 3–7 read this decision.

Facts found while planning: User Login (`83572007…`) and Admin Login (`8a711944…`) are `AUTHORIZATION_CODE` (+ `REFRESH_TOKEN`; Admin also `TOKEN_EXCHANGE`) with `CLIENT_SECRET_POST` and PKCE required; the working CIBA apps are `CIBA` grant with `CLIENT_SECRET_BASIC`. A PingOne CIBA request picks its DaVinci flow policy from `acr_values` (a policy ID), or the app's assignment.

- [ ] **Step 1:** Write `scripts/spike-ciba-login.mjs` (read-only by default; `--apply` adds the grant to a **throwaway copy** of the User Login app, never the real one). It tries, in order: (a) create a throwaway confidential app with `CIBA` + `REFRESH_TOKEN`, scopes of the login app, `CLIENT_SECRET_POST`, assign the `CIBA - EMAIL` flow policy; (b) `POST /as/cibaAuthorization` with client-secret-post and `acr_values=<CIBA - EMAIL policy id>`; (c) after approval, inspect the tokens.
- [ ] **Step 2:** Record in the result doc, with evidence: does PingOne accept CIBA with `CLIENT_SECRET_POST`? Does the access token carry the audience/scopes the BFF needs (compare to a normal login token)? Is a refresh token issued? Can the admin role be derived from the claims the callback uses (read how `/callback` derives `authedUser.role` first)? Does `acr_values` select the email vs SMS policy on one app?
- [ ] **Step 3:** If (b) fails on auth method, try R2: CIBA token from the existing CIBA app → RFC 8693 exchange with the token-exchanger client to the login audience. Record the outcome.
- [ ] **Step 4:** Decide R1, R2 or R3 in the result doc, with the cost of each. Delete the throwaway app. Commit the script and doc. **Gate:** the owner reads the decision before Milestone 2 starts; R3 means revising the design first.

---

## Milestone 2 — PingOne

### Task 2: Extract `establishUserSession` from the user callback

**Files:**
- Create: `demo_api_server/services/userSessionService.js`
- Modify: `demo_api_server/routes/oauthUser.js` (the post-exchange tail of `router.get('/callback')`, roughly the code after `exchangeCodeForToken` through `req.session.save`)
- Test: `demo_api_server/tests/userSessionService.test.js`, existing `demo_api_server/tests/oauthUser*.test.js` must still pass unchanged

**Interfaces:**
- Produces: `establishUserSession(req, res, { tokenData, idTokenClaims, provider, clientType, loginTraceId }) -> Promise<{ ok: true } | { ok: false, reason: string }>` — regenerates the session, stores `oauthTokens`, `user`, `clientType`, `oauthType='user'`, `oauthProvider`, `consentAcr`, `mayAct`, runs login introspection, saves. Does **not** redirect; the caller decides the response.

- [ ] **Step 1:** Write characterization tests against the current `/callback` for: session regenerated, `oauthType==='user'`, tokens stored, `consentAcr`/`mayAct` set, failure to regenerate aborts the login. Run them against unchanged code; expected PASS.
- [ ] **Step 2:** Move the tail into `establishUserSession` with the signature above; `/callback` calls it and keeps its redirects. Hosted-access, ID-JAG, userinfo merge and audit stay in `/callback` (they are redirect-flow concerns).
- [ ] **Step 3:** Run all `oauthUser*` tests and the characterization tests. Expected: PASS, no behavior change.
- [ ] **Step 4:** Commit: `refactor(auth): extract establishUserSession from the user callback`.

### Task 3: Extract `establishAdminSession` from the admin callback

**Files:**
- Create: `demo_api_server/services/adminSessionService.js`
- Modify: `demo_api_server/routes/oauth.js` (admin `/callback` tail)
- Test: `demo_api_server/tests/adminSessionService.test.js`

**Interfaces:**
- Produces: `establishAdminSession(req, res, { tokenData, idTokenClaims, provider, clientType, loginTraceId }) -> Promise<{ ok: true } | { ok: false, reason: string }>`; same contract as Task 2 with `oauthType='admin'`.

- [ ] **Steps 1–4:** Same four steps as Task 2 applied to the admin callback. Commit: `refactor(auth): extract establishAdminSession from the admin callback`.

### Task 4: CIBA login service and BFF routes

**Files:**
- Create: `demo_api_server/services/cibaLoginService.js`
- Create: `demo_api_server/routes/cibaLogin.js` (mounted at `/api/auth/ciba/login`)
- Modify: `demo_api_server/services/cibaService.js` (add a `clientKind` option so initiate/poll can use the login-app credentials chosen in Task 1)
- Modify: the server entry that mounts routes (find where `routes/ciba.js` is mounted and mount next to it)
- Test: `demo_api_server/tests/cibaLogin.test.js`

**Interfaces:**
- Consumes: `establishUserSession`, `establishAdminSession` (Tasks 2–3); `pingOneUserLookupService` for identifier→user id; `config/cibaVerticalCodes.js`.
- Produces:
  - `POST /api/auth/ciba/login/start` body `{ identifier: string, channel: 'email'|'sms', role: 'customer'|'admin' }` → `200 { authReqId: string, matchCode: string, expiresIn: 120, interval: 2 }` for **every** well-formed request (real or decoy).
  - `GET /api/auth/ciba/login/poll/:authReqId` → `200 { status: 'pending' }` | `200 { status: 'approved', redirectTo: string }` (session established) | `410 { status: 'expired' }`.
  - `cibaLoginService.startLogin({ identifier, channel, role, req }) -> { authReqId, matchCode, expiresIn, interval }`, `cibaLoginService.pollLogin({ authReqId, req, res }) -> { status, redirectTo? }`.

- [ ] **Step 1:** Write failing tests in `cibaLogin.test.js`, asserting: (a) known user → real CIBA request with the vertical-prefixed match code; (b) unknown identifier and a user lacking the channel return the same response shape/status/timing class as (a) and their poll returns `pending` then `410` after expiry, never `approved` (Review Focus 1); (c) ID-token `sub` ≠ identified user → poll never approves and no session is created (2); (d) the 6th `start` for one identifier or one IP within the window returns `429` and sends no extra message (3); (e) a successful poll regenerates the session id, a second poll of the same `authReqId` returns `410`, and a different session's poll of it returns `404` (4); (f) `role:'admin'` calls `establishAdminSession`, `role:'customer'` calls `establishUserSession`.
- [ ] **Step 2:** Run them; expected FAIL (module not found).
- [ ] **Step 3:** Implement per the Task 1 decision (R1: login-app credentials + `acr_values`=flow-policy id for the channel; R2: existing CIBA app + token exchange). Decoys are stored in the same pending map with `decoy:true` and never contact PingOne. Pending map keyed by session id + `authReqId`, TTL 150 s.
- [ ] **Step 4:** Run `npx jest tests/cibaLogin.test.js tests/ciba.test.js tests/cibaService.test.js`; expected PASS.
- [ ] **Step 5:** Commit: `feat(auth): CIBA login routes (start/poll) for customer and admin`.

### Task 5: Sign-in modal — two buttons and the link panel

**Files:**
- Create: `demo_api_ui/src/components/CibaLoginPanel.jsx`
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx` (`begin()` ~196–223 and the step render), `demo_api_ui/src/utils/signInService.js` (add `cibaLogin` availability)
- Test: `demo_api_ui/src/components/__tests__/CibaLoginPanel.test.jsx`, `PiFlowSignInModal.test.jsx` (extend)

**Interfaces:**
- Consumes: `POST /api/auth/ciba/login/start`, `GET /api/auth/ciba/login/poll/:authReqId` (Task 4).
- Produces: `<CibaLoginPanel role onSignedIn(redirectTo) onUsePassword onBack />`; modal step name `'cibaLogin'`.

- [ ] **Step 1:** Write failing tests: the modal for both roles shows "Sign in with passkey" and "Sign in with CIBA (email or SMS)" up front and **no** password field by default (admin included); pressing the link button shows the identifier input, then email/text buttons (both always), then the waiting screen with the match code and the same copy as `cibaWaitingText`; a `pending` poll keeps waiting, `approved` calls `onSignedIn(redirectTo)`, `expired` shows a retry; a "use a password instead" link renders the existing password step; under PingFederate the link button is present and the passkey button is hidden (per the design call).
- [ ] **Step 2:** Run them; expected FAIL.
- [ ] **Step 3:** Implement the panel and the modal wiring; keep `fallback:true` handling untouched.
- [ ] **Step 4:** Run `npx vitest run src/components/__tests__/CibaLoginPanel.test.jsx src/components/__tests__/PiFlowSignInModal.test.jsx`; expected PASS.
- [ ] **Step 5:** Commit: `feat(ui): sign in with passkey or CIBA approval link`.

### Task 6: PingOne provisioning script for CIBA login

**Files:**
- Create: `scripts/pingone/enable-ciba-login.mjs`
- Create: `scripts/pingone/__tests__/enable-ciba-login.test.mjs` (pure planning function only)

**Interfaces:**
- Produces: `planCibaLogin(currentApps, currentAssignments) -> Array<{op, target, body}>` (pure, additive-only) and the CLI `--out <dir> [--apply]` that backs up each touched app, applies, and reads back. Shape depends on the Task 1 decision (R1: add the `CIBA` grant + flow-policy assignments to User Login and Admin Login; R2: add the exchange permission only).

- [ ] **Step 1:** Write failing tests for `planCibaLogin`: it never emits a delete or reorders existing assignments; it is idempotent (second run plans nothing).
- [ ] **Step 2:** Run; expected FAIL. **Step 3:** Implement. **Step 4:** Run; expected PASS.
- [ ] **Step 5:** Dry-run against PingOne, owner reviews the plan, run with `--apply`, confirm readback. Commit.

### Task 7: Admin lockout gate and PingOne rollout

**Files:** none (verification + deploy).

- [ ] **Step 1:** Before the cutover, record that the demo admin signs in by password and by the existing passkey/device path.
- [ ] **Step 2:** Merge Tasks 2–6 in order; deploy the API server then the frontend (focused, per service).
- [ ] **Step 3:** Owner signs in as demo admin by passkey, by link (email and text) and by the password break-glass path; same for the demo customer. Check `CIBA_AUTHENTICATION.SUCCEEDED` for the User Login / Admin Login app in the PingOne audit log for each link sign-in. **Gate:** if any admin path fails, roll the frontend back and stop.

---

## Milestone 3 — PingFederate

### Task 8: PF recon (read-only) and decision

**Files:** Create: `docs/superpowers/specs/2026-10-17-pf-link-login-recon.md`

- [ ] **Step 1:** Record, with evidence from the live PF admin API and `scripts/pingfederate/README.md`: where PF runs and whether it can reach the BFF; whether the OOB plugin JAR can be deployed there (deploy dir, restart); whether PF can enable the CIBA grant for the login client; how a PF user maps to a PingOne user for email/phone (`pingOneUserIdFor`); whether PF offers any passkey adapter. **Gate:** owner reads it; "cannot deploy the plugin" moves PF to a later phase.

### Task 9: Link-bridge plugin and BFF bridge endpoints

**Files:**
- Create: `scripts/pingfederate/plugins/ai-agent-ciba-approver/java/com/pingidentity/demo/ciba/PingOneLinkBridgeAuthenticator.java` (+ its entry in `PF-INF/oob-auth-plugins`)
- Create: `demo_api_server/routes/pfCibaLinkBridge.js` (`POST /api/pf-ai-agent/ciba/link-bridge/start`, `GET /api/pf-ai-agent/ciba/link-bridge/status/:id`)
- Test: `scripts/pingfederate/plugins/ai-agent-ciba-approver/test.sh` extended; `demo_api_server/tests/pfCibaLinkBridge.test.js`

**Interfaces:**
- Produces: plugin `initiate(request, params)` → calls the BFF `start` with the `login_hint` and channel, returns the BFF's request id as the transaction id; `check(transactionId, params)` → maps BFF `pending|approved|denied|expired` to the OOB result. BFF `start` reuses `cibaService.initiateBackchannelAuth` with the existing email/SMS CIBA apps and a shared-secret header; `status` reuses the poll logic and returns only the status.

- [ ] **Steps 1–5:** failing BFF tests (auth header required; start never reveals unknown users; status maps states) → implement → java `test.sh` for `initiate`/`check` mapping → commit.

### Task 10: PF provisioning and PF login routes

**Files:**
- Modify: `scripts/pingfederate/provision-ciba.js` (add `--link-bridge`: authenticator, request policy, client; dry-run default, read-back)
- Modify: `demo_api_server/services/cibaLoginService.js` (provider `pingfederate`: call PF `bc-auth.ciba`, poll PF token endpoint, then `establishUserSession` with `provider:'pingfederate'`)
- Test: `demo_api_server/tests/cibaLogin.pf.test.js`

- [ ] **Steps 1–5:** failing tests (PF start returns the same uniform response; PF approval establishes a PF-provider session; PF user without a linked PingOne user gets the uniform decoy-style response) → implement → dry-run `provision-ciba.js --link-bridge`, owner approves, `--apply` → commit.

### Task 11: PF modal entry and rollout

**Files:** Modify `demo_api_ui/src/components/PiFlowSignInModal.jsx` (re-enable a PF link entry in `begin()` — it opens password-first under PF after #1470), test in `PiFlowSignInModal.test.jsx`.

- [ ] **Steps 1–3:** failing test (PF shows the link button, hides passkey unless PF reports one) → implement → run vitest. **Step 4:** Deploy and verify a PF customer and a PF admin sign in by link and still by password. **Gate:** admin lockout check as in Task 7.
