# Customer Sign-in: Password + CIBA Approval Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can sign in with password + an emailed/texted CIBA approval link as proof of identity; the session still comes from the normal login client.

**Architecture:** The pi.flow password step (normal client, default policy) finishes; instead of completing, the BFF PARKS the finished flow in the user's server session and starts a CIBA approval for that user through the EXISTING CIBA step-up apps. After an approval whose ID-token `sub` equals the user the password step authenticated, the parked flow completes through the existing `completePiFlow` → `/callback` path. Passwordless (device/passkey) is untouched.

**Tech Stack:** Node/Express BFF (`demo_api_server`, jest), React SPA (`demo_api_ui`, vitest), existing `cibaService` (step-up CIBA apps, client_secret_basic), `piFlowDriver`.

**Spec:** `docs/superpowers/specs/2026-10-18-passwordless-login-design-update-ciba-second-factor.md` (supersedes the CIBA-as-login-client parts of `2026-10-17-passwordless-login-design.md`).

## Global Constraints

- CIBA is proof of identity ONLY. No CIBA tokens become the session; no change to refresh, introspection or token exchange; no PingOne or PingFederate configuration change (the existing CIBA email/SMS apps and DaVinci flows are used as they are).
- The browser has NO authenticated session or auth cookie until the approval succeeds.
- Parked flow: bound to the originating browser session, single-use, expires after 150 s, discarded on any failure.
- The approval's ID-token `sub` must equal the PingOne user id the password step authenticated.
- `binding_message` = 2-char vertical code + 6 hex chars (8 chars, PingOne max), from `cibaService.newMatchCode` / `initiateBackchannelAuth`; CIBA request lifetime 120 s, poll interval 2 s.
- Match-code wording identical to CIBA step-up: "We sent an approval link by {email|text message}. There is nothing to type: open the link, check the page shows match code {code}, then tap Approve."
- Customer only: the admin handler never parks and the admin modal behaves as before this feature. PingFederate is out of scope (the PF modal path is unchanged).
- Everything ships OFF behind `ciba_login_enabled` (env `CIBA_LOGIN_ENABLED`); with the flag off the credentials route ignores `secondFactor` and the modal shows no choice screen.
- Passwordless and plain password sign-in stay byte-for-byte as they are when `secondFactor` is absent.
- Flow: worktree → PR → owner merges (`gh pr merge` is classifier-blocked; hand the owner the command) → focused deploy. No PingOne/PF writes in this plan.

## Review Focus

1. No session or cookie before approval: after the password step with `secondFactor:'ciba'` the response has no `redirectTo`, no auth cookie, and the session has no tokens/user. (Task 1)
2. Wrong person's approval: an ID token whose `sub` differs never completes the flow and discards the parked state. (Task 2)
3. Parked-flow replay/hijack: a second completion is rejected; a different browser session cannot poll or complete it; a parked flow older than 150 s cannot complete. (Tasks 1–2)
4. Prompt-bombing: >5 sends per user per 10 min and >5 starts per IP per 10 min are refused with no extra CIBA request. A wrong password (401) never parks. (Tasks 1–2)
5. Password step ends in anything other than `COMPLETED` (device/agreement/other step): nothing is parked and today's behavior applies; plain password login (no `secondFactor`) and the admin handler are unchanged. (Task 1)

---

### Task 1: Park the finished password flow

**Files:**
- Modify: `demo_api_server/services/piFlowDriver.js` (`makePiFlowHandlers`, `handleCredentialsStep`, `completePiFlow`; add park/complete helpers)
- Modify: `demo_api_server/routes/oauthUser.js` (`makePiFlowHandlers({ ..., allowSecondFactor: true })` for the user router only)
- Test: `demo_api_server/tests/piFlowSecondFactor.test.js`

**Interfaces:**
- Produces (on the object `makePiFlowHandlers` returns, and exported to the routes via the user router: `module.exports.piFlowHandlers = piFlowHandlers`):
  - `finishPiFlow(req, pending, cookies, body) -> Promise<{ redirectTo: string } | { status: number, error: string }>` — the code/redirect logic extracted from `completePiFlow` (which becomes a thin wrapper that sends the result with `req.session.save`).
  - `getParkedFlow(req) -> { expectedSub: string, username: string, user: { id, username, email, mobilePhone, enabled } } | null` — null when none or older than 150 s (and then deletes it).
  - `completeParkedFlow(req) -> Promise<{ redirectTo: string } | { status: number, error: string }>` — single-use: deletes the parked state BEFORE calling `finishPiFlow`.
  - `discardParkedFlow(req) -> void`.
- Request/response contract: `POST /api/auth/oauth/user/pi-flow/credentials` body may include `secondFactor: 'ciba'`. Only when `allowSecondFactor` is true, the flag is on, the password step returns `COMPLETED`: it parks (`req.session.oauthPiFlowParked = { pending, cookies, body, username, expectedSub, user, parkedAt }`, removes `req.session.oauthPiFlow`) and answers `200 { step: 'approval', channels: ['email'|'sms', …] }` where `channels` lists only what the authenticated user has (`email` if the user has an email, `sms` if a mobile phone); otherwise today's behavior.

- [ ] **Step 1: Write failing tests** in `piFlowSecondFactor.test.js` (reuse the harness style of `tests/oauthUserPiFlow.test.js`): (a) with `secondFactor:'ciba'` + flag on + PingOne returning COMPLETED, the response is `{ step:'approval', channels:[…] }`, has NO `redirectTo`, sets no auth cookie, `/as/resume` is NOT called, and the session holds `oauthPiFlowParked` but no `oauthTokens`/`user`; (b) a wrong password (401) parks nothing; (c) a password step ending in `DEVICE_SELECTION_REQUIRED`/other statuses parks nothing and behaves as today; (d) flag off, or `secondFactor` absent, or the admin handler: behaves exactly as before (COMPLETED → `redirectTo`); (e) `getParkedFlow` returns null and clears after 150 s (fake clock); (f) `completeParkedFlow` returns the `redirectTo` once, and a second call returns an error and no redirect; (g) `completeParkedFlow` from a session without parked state errors; (h) `channels` only includes `sms` when the user has a mobile phone.
- [ ] **Step 2: Run** `cd demo_api_server && npx jest piFlowSecondFactor` — expected FAIL.
- [ ] **Step 3: Implement** the interfaces above. Resolve the PingOne user with `resolvePingOneIdentifier(username)` from `services/pingOneUserLookupService` (as `cibaLoginService` does); if it cannot be resolved, do not park (fall through to today's `completePiFlow`) — a signed-in password user with no resolvable record keeps working as before. Read the flag with `configStore.getEffective('ciba_login_enabled')` at request time. Extract `finishPiFlow` without changing `completePiFlow`'s observable behavior (existing `oauthUserPiFlow.test.js` and `oauthAdminPiFlow.test.js` pass unchanged).
- [ ] **Step 4: Run** `npx jest piFlowSecondFactor oauthUserPiFlow oauthAdminPiFlow piFlow` — expected all PASS.
- [ ] **Step 5: Commit** `feat(auth): park the finished password flow when approval is required`.

### Task 2: CIBA approval service and routes (pre-session)

**Files:**
- Create: `demo_api_server/services/cibaSecondFactorService.js`
- Modify: `demo_api_server/routes/cibaLogin.js` (same mount path `/api/auth/ciba/login`, same flag guard returning 404 `ciba_login_disabled`)
- Delete: `demo_api_server/services/cibaLoginService.js`, `demo_api_server/tests/cibaLogin.test.js` (the login-app CIBA design is dropped); keep `adminSignalResolver`, `userSessionService`, `adminSessionService`, `cibaService.newMatchCode` (still used elsewhere).
- Test: `demo_api_server/tests/cibaSecondFactor.test.js`

**Interfaces:**
- Consumes: Task 1's `getParkedFlow`, `completeParkedFlow`, `discardParkedFlow`; `cibaService.initiateBackchannelAuth(loginHint, bindingMessage, scope, acrValues, channel, verticalId) -> { auth_req_id, interval, binding_message }`, `cibaService.pollForTokens(authReqId, channel)` (throws an axios error whose `response.data.error` is `authorization_pending` / `slow_down` / `access_denied` / `expired_token`), `cibaService.validateCibaIdToken(idToken, expectedSubject, '', channel)` (throws on a `sub` mismatch); `verticalManifest.resolver.activeIdFor(req)`.
- Produces: `startSecondFactor({ channel, req }) -> Promise<{ authReqId: string, matchCode: string, expiresIn: 120, interval: 2 }>` (throws `NoParkedFlowError`, `RateLimitedError`, `ChannelUnavailableError`); `pollSecondFactor({ authReqId, req }) -> Promise<{ status: 'pending' } | { status: 'approved', redirectTo: string } | { status: 'expired' | 'denied' | 'notfound' }>`.
- Routes: `POST /api/auth/ciba/login/start` body `{ channel:'email'|'sms' }` (JSON only else 415; 409 `no_parked_flow`; 400 `channel_unavailable`; 429 `rate_limited`) → 200 `{ authReqId, matchCode, expiresIn, interval }`; `GET /api/auth/ciba/login/poll/:authReqId` → 200 `{status:'pending'}` | 200 `{status:'approved', redirectTo}` | 403 `{status:'denied'}` | 410 `{status:'expired'}` | 404.

- [ ] **Step 1: Write failing tests** in `cibaSecondFactor.test.js` (mock `axios`/`cibaService` HTTP; no sockets): (a) start with no parked flow → 409 and no CIBA request; (b) start uses the PARKED user (login_hint = the user's PingOne id), the chosen channel's CIBA app, a vertical-prefixed 8-char match code, and returns our own random `authReqId` (PingOne's `auth_req_id` never reaches the browser); (c) a channel the user lacks → 400 `channel_unavailable`, nothing sent; (d) per-IP limit: the 6th start in 10 min → 429 with no CIBA request; per-user cap: 5 sends per 10 min, the 6th → 429 `rate_limited` (the user is authenticated, so a visible 429 is fine); (e) poll `authorization_pending` → pending; approved with a matching `sub` → `completeParkedFlow` called once, response `{status:'approved', redirectTo}`; (f) approved with a DIFFERENT `sub` → `{status:'denied'}`, `discardParkedFlow` called, `completeParkedFlow` NOT called; (g) `access_denied` → denied (parked discarded), `expired_token` → expired (parked discarded); (h) replay: a second poll after success → 410, no second completion; (i) a poll from a different browser session → 404 and nothing completes; (j) a pending entry older than 150 s → expired and the parked flow discarded; (k) flag off → every route 404 `ciba_login_disabled` before body/content-type checks; (l) PingFederate provider → 503 `provider_unsupported` (this plan is PingOne only).
- [ ] **Step 2: Run** `npx jest cibaSecondFactor` — expected FAIL.
- [ ] **Step 3: Implement** the service. Reuse (copy, then delete the old file) the proven pieces from `cibaLoginService.js`: the rate-limit helper keyed `ip:${req.ip}` and `send:${user.id}`, the in-process pending map with session binding (the pending entry is bound to `req.sessionID`, which does not change until `/callback` regenerates the session, so one id is enough), one-shot tombstones, TTL sweep, and `ProviderUnsupportedError`. Drop the decoys, the identifier lookup, the role bundles, the admin-signal guard and the timing floors.
- [ ] **Step 4: Run** `npx jest cibaSecondFactor ciba cibaService piFlowSecondFactor oauthUser userSessionService adminSessionService` — expected all PASS, existing step-up tests unchanged.
- [ ] **Step 5: Commit** `feat(auth): pre-session CIBA approval for the parked password flow` (and a separate `chore(auth): remove the login-app CIBA service` commit for the deletions).

### Task 3: Sign-in modal — password + approval link

**Files:**
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx` (choice screen, `submit()` body, new `approval` step; `choiceFirst` now requires `roleRef.current === 'customer'`)
- Rewrite: `demo_api_ui/src/components/CibaLoginPanel.jsx` → `CibaApprovalPanel.jsx` (delete the old file and its test)
- Test: `demo_api_ui/src/components/__tests__/CibaApprovalPanel.test.jsx`, `PiFlowSignInModal.test.jsx` (extend)

**Interfaces:**
- Consumes: Task 2's routes (`POST …/ciba/login/start { channel }`, `GET …/ciba/login/poll/:authReqId`); Task 1's credentials response `{ step:'approval', channels }`.
- Produces: `<CibaApprovalPanel channels onApproved(redirectTo) onCancel />`; modal step name `'approval'`; the choice screen buttons "Sign in with passkey" (existing device-first path) and "Sign in with password + approval link (email or text)" which opens the password step with a ref `secondFactorRef = 'ciba'` so `submit()` sends `secondFactor: 'ciba'`; "Use a password instead" removed from the panel, the plain password step stays reachable from the choice screen.

- [ ] **Step 1: Write failing tests**: panel — opens on the channel choice (only the channels passed, so a user without a phone is never offered text); start called with the right JSON body and headers; waiting screen shows the match code and the exact wording; pending keeps waiting; approved calls `onApproved(redirectTo)`; 403/410/404/5xx/network failure/429 show an error with retry and STOP polling; cancel/unmount stops polling (fake timers: no fetch after cancel); a fast double click sends ONE start (ref guard). Modal — flag on + customer: choice screen has both buttons; "password + approval link" shows the password form and the credentials POST body includes `secondFactor:'ciba'`; a `{step:'approval', channels}` response shows the panel (NO navigation, no overlay) and `onApproved` navigates exactly as the modal does after a COMPLETED; the plain password and passkey buttons send no `secondFactor`; flag off, ADMIN role, and PingFederate keep the pre-feature first step and no new buttons.
- [ ] **Step 2: Run** `cd demo_api_ui && npx vitest run src/components/__tests__/CibaApprovalPanel.test.jsx src/components/__tests__/PiFlowSignInModal.test.jsx` — expected FAIL.
- [ ] **Step 3: Implement** per the interfaces; keep the `begin()` change minimal and commented (another session edits it for PF); reuse the existing styles; accessibility as before (labelled inputs, focus on step change, status in an aria-live region, countdown not announced each second, match code large and letter-spaced).
- [ ] **Step 4: Run** the same vitest command plus eslint on the touched files — expected PASS, no new warnings.
- [ ] **Step 5: Commit** `feat(ui): sign in with password + CIBA approval link`.

### Task 4: Merge, deploy (flag off) and the live check

**Files:** none (verification + rollout).

- [ ] **Step 1:** PR for Tasks 1–3; owner merges; focused deploy of the API server and frontend (flag stays OFF). Verify the live pods' digests and `ciba_login_enabled=false`.
- [ ] **Step 2 (owner):** set `CIBA_LOGIN_ENABLED=true`, sign in as the demo customer with password + approval link by email and by text. Expected: password accepted, waiting screen with an 8-char match code starting with the vertical's letters, the approval page shows the same code, approving signs in; a wrong approver or an expired link does not.
- [ ] **Step 3:** confirm in the PingOne audit log a `CIBA_AUTHENTICATION.SUCCEEDED` for the demo user on the CIBA step-up app, and that plain password and passwordless sign-in still work. Rollback = flag off.
