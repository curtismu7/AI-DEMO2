# MFA tester (catalog A1) - standalone repo audit

Read-only research. Paths are under /Users/cmuir/Development/AI-DEMO2 unless noted. Sizes are bytes (wc -c). "UNVERIFIED" = not proven by reading code or running anything.

## 0. Headline

- A1 is a Tester (plan: planning/standalone-demo-family-plan.md line 96; "own repo" rule at lines 31 and 239; phase 1 batch at line 230). It serves stories S18 (Mary lost her phone) and S16 (Mark signs up and adds a passkey) per planning/standalone-demo-stories.md lines 96, 98, 136.
- The bulk of the server logic already exists and is mostly self-contained: demo_api_server/services/mfaService.js (54,651 B) talks straight to PingOne with a worker token. The big problems are (a) the UI is a 115 KB monolith, MFATestPage.tsx, tangled with AI-DEMO2 shell; (b) several things the tester NEEDS do not exist at all: per-policy decision visibility, real push, a mock mode for the PingOne device APIs, Mary/recovery story content.
- The "mfa-demo" devdocs sample source is NOT on this machine (searched ~/Development; devdocs-sample-apps-main, devdocs-fixes, devdocs-review do not exist now; ~/Development/pingone-sample-apps-skill holds only SKILL.md). So sample-app claims below rest on the skill text and demo_api_ui/src/data/sampleApps.js, marked UNVERIFIED against sample code.

## 1. Reusable assets

Coupling: low = copy nearly as-is; med = needs seams replaced (configStore, session, auth middleware); high = rewrite or lift only ideas.

### 1a. Server

| Path | What it does | Size | Coupling |
|---|---|---|---|
| demo_api_server/services/mfaService.js | Worker token; default policy resolve (GET deviceAuthenticationPolicies); deviceAuthentications initiate/select/otp-check/assertion-check/status; device list/create/activate/delete/nickname for SMS, EMAIL, TOTP, FIDO2; one-time OTP; FIDO2 RP/policy fix (fido2Policies); FIDO metadata (fidoDevicesMetadata/{aaguid}) | 54,651 | med: requires ./configStore (getEffective), ./oauthEndpointResolver, ./oauthService, ../utils/sanitizeAxiosCause (lines 2-5). Replace with a plain config object. |
| demo_api_server/routes/mfaTest.js | Test harness API: /integration/* (initiate, select-device, verify-otp, verify-fido2, status, enroll-sms/totp/email/fido2 init+complete, devices, fido2-metadata), /push-mock/*, /worker-token, /users, /logs, /session-user | 56,735 | high: authenticateToken, oauthUserService, pingOneSessionUser (PF-to-P1 user link), apiCallTrackerService, configStore. Lift handlers, drop the PF-link and tracker. |
| demo_api_server/routes/mfa.js | Production twin: challenge/OTP/FIDO2, devices, enroll, forgot-password, an admin-gated route that ensures the FIDO2 relying party | 33,049 | high: posthog, pingOneUserService, lookup service, rate limiters. Reference only. |
| demo_api_server/services/piFlowDriver.js | pi.flow server driver: authorize response_mode=pi.flow, flows/{id} steps, OTP_REQUIRED / DEVICE_SELECTION_REQUIRED / ASSERTION_REQUIRED / MFA_COMPLETED handling, cookie jar merge, PF vs P1 branches | 32,735 | high: session shape req.session.oauthPiFlow, PF/AIC branches, hosted-wall park. Use as the spec; reimplement a smaller P1-only driver (the plan says pi.flow only). |
| demo_api_server/services/mockPushPhoneService.js | Session-scoped simulated push phone (number-to-match, approve/deny, 2 min expiry); never calls PingOne | 1,876 | low (only crypto, req.session) |
| demo_api_server/routes/consentMockPhone.js + services/consentMockPhoneService.js | Mock CIBA on the mock phone (start/status/decision) | 691 + 3,987 | low-med (consentMockPhoneService requires ./pfAiAgentTrace) |
| demo_api_server/services/cibaService.js | Real CIBA via PingOne /as/cibaAuthorization; 8-char binding_message guard (MAX_BINDING_MESSAGE = 8, line 79) | 10,138 | med: config/oauth, configStore, appEventService, tokenValidationService, cibaVerticalCodes |
| demo_api_server/services/cibaSimulatedService.js | Simulated CIBA fallback | 2,026 | low (crypto, appEventService) |
| demo_api_server/services/cibaSecondFactorService.js, routes/cibaLogin.js | Password + CIBA approval link as sign-in factor (flag-gated, shipped OFF) | 8,737 | high; out of scope for A1 (belongs to A3/A4) |
| demo_api_server/utils/mfaLogger.js | File-backed MFA API call log (req/resp, redaction) | 7,330 | low (fs, path) |
| fido2-fix/mfaService.js + FIDO2_FIX_INSTRUCTIONS.md + mfaService.test.js | Older snapshot of mfaService (12,265 B) plus the FIDO2-activate fix notes (POST + vendor content type + flat body + origin) and 17,287 B test | 12,265 / 2,529 / 17,287 | low, but STALE: the live demo_api_server/services/mfaService.js already contains the fix (line 1180 posts activation); treat fido2-fix as documentation of the bug, not source. |
| demo_api_server tests: src/__tests__/mfaService.test.js, mfaTest.routes.test.js; tests/mfaService.deviceLimit/deviceNickname, mfaTest.totpEnroll/pushMock/workerToken/registeredFidoMetadata, mfaDevices.route, mfaEnsureFido2RpAdminGate | Unit/route tests with mocked axios | not sized | med: follow whichever module they import |
| scripts/pingfederate/create-pingone-mfa-adapter.js, enable-pf-mfa-step-up.js, list-pingone-mfa-inputs.js | PF "PingOne MFA" adapter wiring | not sized | high, PF-only; not needed for the tester |

### 1b. UI (demo_api_ui/src)

| Path | What it does | Size | Coupling |
|---|---|---|---|
| components/MFATestPage.tsx | The whole MFA Test page: config, devices, SMS/email/TOTP/FIDO2 enroll + verify, push mock, CIBA, FIDO metadata, API-call previews | 115,594 | high: apiClient, toasts, ThemeContext, signInService, EmbeddedFlowDiagram, PingOneApiPanel. Split into sections; do not copy whole. |
| components/MFATestCard.jsx, MFATestPage.css | Card shell + styles | 3,394 / 25,660 | low / med (CSS tokens) |
| components/MFATestTotpSection.tsx | TOTP enroll + activate (uses secret returned by PingOne) | 6,049 | low-med |
| components/MFATestSignInSection.tsx, MFATestStepUpSection.tsx, MFATestForgotPasswordSection.tsx, MFATestConsentSection.tsx, MFATestCibaSection.tsx, MFATestPfCibaSection.tsx, MFATestProtectSection.tsx | "How the app uses MFA" cards | 3,595 / 14,120 / 8,416 / 7,180 / 10,084 / 10,010 / 4,976 | med to high (talk to AI-DEMO2 routes); keep ForgotPassword (S18) and StepUp as reference |
| components/Fido2Challenge.js, utils/passkeyCeremony.js | WebAuthn create/get ceremony wrapper | 7,459 / 8,409 | low (browser API + one POST); passkeyCeremony has a test |
| components/OtpStepUpModal.js | OTP/device/passkey step-up modal | 46,512 | high |
| components/FidoStepUpModal.js | FIDO step-up modal | 3,848 | med |
| components/PiFlowSignInModal.jsx, lib/embeddedPiFlow.js | pi.flow sign-in modal (device-first and password-first) | 43,435 / 8,858 | high / med |
| components/ForgotPasswordFlow.jsx | Forgot-password via OTP (S18-adjacent) | 7,103 | med |
| components/MFALogsModal.jsx | Log viewer for mfaLogger | 5,381 | low-med |
| components/ConsentMockPhoneFlow.jsx/.css | Mock phone UI | 5,133 / 3,044 | low (CSS duplicated from PF AI Agent page, per memory note) |
| utils/mfaEnrollment.js | Enrollment helpers | 3,390 | low |
| config/mfaDiagramsStandards.js, consentMockPhoneDiagram.js, cibaApprovalLinkDiagram.js | ReactFlow diagram configs (diagrams must be ReactFlow, never mermaid; need movable boxes + Simulate + Reset + speed) | 14,234 / 4,462 / 7,935 | low-med |

### 1c. Docs and skills

| Path | Use |
|---|---|
| claudSkills/pingone/pingone-mfa/SKILL.md and reference/*.md (10 files, 59,485 B total: device-sms/email/totp/fido2/mobile-push/whatsapp, devices-api, device-authentications-api, onetime-otp-flow, policy-and-scopes) | Best API reference in-repo. Header caveat: banking-specific names; it says it is "Partially wired" for policies. |
| docs/MFA_TEST_PLAN.md, docs/user-guide/MFA_SETUP_GUIDE.md, MFA_USER_SETUP.md, docs/use-cases/mfa-test-harness.md (auto-generated, UC-LEARN16) | Test plan and setup |
| docs/PingOne Authentication v4 - MFA included.postman_collection.json | Authoritative request list for pi.flow MFA: Start Auth Code Flow (authorize response_mode=pi.flow), Check Username/Password, Select MFA Device, Check OTP, Get Auth Code (as/resume), Exchange Code, Session Reset, Forgot Password, Password Change, Transactional MFA (acr_values=Step_Up, login_hint_token, request object). Read it with python; it is the one place with the Transactional MFA calls. |
| docs/superpowers/plans/2026-05-21-email-otp-device-enrollment.md, 2026-08-11-sdk-login-mfa-stepup.md; docs/ciba-handoff.md, docs/ciba-real-provisioning-todo.md; docs/PINGFEDERATE_MFA_STATUS.md | Background; PF material not needed |
| docs/Super-Banking-MFA-DeviceAuthentication-Flow.drawio, docs/diagrams/mfa-flow.drawio | Flow drawings (redraw in ReactFlow) |
| ~/Development/pingone-sample-apps-skill/pingone-sample-apps/SKILL.md (also ~/.claude/skills/pingone-sample-apps/SKILL.md) | mfa-demo facts: needs Identity Data Admin + Environment Admin; "Pairing device type EMAIL is not allowed" fix = enable Email in default device auth policy; no mock, needs real inbox; flows/{id} needs session cookies; validates creds at boot |
| demo_api_ui/src/data/sampleApps.js lines 98-120 | Says mfa-demo "/flows/{id} needs a worker bearer token" claim does NOT hold: the endpoint is on auth.pingone.com and rejects a management-API token |

## 2. Proposed standalone repo layout (name: mfa-tester, cmuir_pingcorp/mfa-tester, private)

Built on demo-kit-base (family plan Phase 1: setup wizard + P1/PF/AIC picker, auth + registration, presenter mode, talk-track/story engine, customer.config, doctor, Reset, app shell, ReactFlow components, token decode/redaction, trace envelope, mock mode, preflight). Layout mirrors id-jag-standalone (npm workspaces `web`, `server`; its package.json lists web, server, resource-as, mcp-sample; scripts sync-to-app.mjs). Base files come from the template and are not hand-edited (hash manifest via sync-to-base.mjs).

```
mfa-tester/
  base/ (from demo-kit-base, synced): setup wizard, auth+registration, presenter, story engine, customer.config, doctor, reset, trace envelope, brand shell
  server/src/
    pingone/mfaClient.js        <- mfaService.js, configStore removed, config object injected
    pingone/policyClient.js     NEW  (policy list/get/clone; decision probes)
    pingone/piFlowMfa.js        NEW small P1-only pi.flow driver (spec: piFlowDriver.js + Postman collection)
    mock/mockTenant.js          NEW  in-memory users/devices/policies/deviceAuthentications state machine
    mock/mockPushPhone.js       <- mockPushPhoneService.js
    routes/{devices,enroll,challenge,policies,recovery,trace}.js  <- split from mfaTest.js
    ciba/                       <- cibaService.js + cibaSimulatedService.js (phase 2 of the tester, optional)
    util/mfaLog.js              <- mfaLogger.js
    test/                       <- ported mfaService / mfaTest tests + new mock-tenant tests
  web/src/
    pages/{Methods,Policies,Devices,Recovery}.tsx
    components/{MethodCard,TotpEnroll,SmsEnroll,EmailEnroll,PasskeyEnroll,PushPhone,DeviceTable,PolicyMatrix,ApiCallPanel}.tsx
    lib/passkeyCeremony.js      <- as-is
    diagrams/                   <- ReactFlow configs per flow
  stories/s18-mary-lost-her-phone.json, s16-mark-adds-a-passkey.json   (story engine data)
  learn/                        (Learning Hub content-pack: glossary, sources)
  scripts/{setup-pingone.mjs, doctor, reset}
  customer.config.json, .env.example, CLAUDE.md
```

Notes: pi.flow sign-in only (no redirect). The tester itself does not need user sign-in to PingOne for device ops (worker token does the work), but base auth+registration gates admin vs user and gives a test-user identity. PF/AIC pickers from base are mostly irrelevant here: MFA devices live in PingOne; memory note says "MFA always runs on PingOne; a PingFederate login maps to the PingOne user with the same username" (routes/mfaTest.js ~line 1383 comment). Recommend the tester be P1-only and hide the picker.

## 3. Tester feature list

Per method, each as a card with: enroll, test (challenge), show the exact PingOne request/response (redacted), show the decoded result, delete.

1. SMS: create device `{type:SMS, phone}`, activate with OTP; challenge via deviceAuthentications. Live needs a real phone; carrier failure is a known trap (section 6). Mock: generated code shown on screen.
2. Email: create `{type:EMAIL, email}`, activate; challenge. Live needs a real inbox (sample-app skill says no mock exists upstream).
3. TOTP: create `{type:TOTP}`; PingOne returns the secret; the tester computes codes itself (RFC 6238 SHA1/30s/6 per memory note ai-demo2-mfa-pi-flow-fixes.md) so enroll+step-up is fully automatable and needs no phone. Best live demo method.
4. FIDO2 / passkey: `{type:FIDO2}` init, browser WebAuthn create, activate with attestation + origin; challenge via ASSERTION_REQUIRED + navigator.credentials.get. Needs RP/origin match (see traps) and an https/localhost origin; PingOne FIDO2 policy rpId must match.
5. Push: only a MOCK exists in code (mockPushPhoneService.js: "Real push needs a phone app built on the PingOne MFA SDK (none is registered here)"). Real push (MOBILE device, pairing key, scopes p1:create:pairingKey per policy-and-scopes.md) is NOT implemented anywhere in routes (mfa.js only labels type MOBILE at line 457). Ship push as mock-only in v1; real push = later, needs iOS sample (~/Development/pingone-authenticator-sample-app-ios exists, UNVERIFIED).
6. Per-policy decision visibility (NEW, not in AI-DEMO2). Proposed: list policies, show per-factor enabled flags, pick a policy and a user, create a deviceAuthentication against that policy (POST body supports `policy.id`; code line 218 in mfaService.js) and show the resulting status (DEVICE_SELECTION_REQUIRED / OTP_REQUIRED / ASSERTION_REQUIRED / PUSH_CONFIRMATION_REQUIRED) plus which of the user's devices are `usable`. Render as a policy x method matrix: what a given user would be offered under each policy. Existing code only does default-policy resolution and a broken diag (section 4 gaps).
7. Device management: list (ACTIVE filter now; also show pending), rename (PUT nickname sub-resource), delete, default/order (UNVERIFIED API for ordering; skill doc mentions "order"), device-limit message (LIMIT_EXCEEDED, memory #1479).
8. Recovery story S18 (Mary lost her phone): scripted scenario: Mary has only SMS device; phone gone; show policy decision at each method; recovery routes = add a second method, delete lost device, forgot-password via email OTP (ForgotPasswordFlow.jsx + routes/mfa.js forgot-password/start|complete), admin reset (delete device). The "policy decision at each method" proof depends on feature 6.
9. Story S16 (Mark signs up and adds a passkey): self-registration (from base auth+registration; the user-registration sample uses pi.flow, user-registration needs inbox) then FIDO2 enroll, then passwordless sign-in with passkey (pi.flow ASSERTION_REQUIRED path, PF-verified in memory but P1 path is the one used here).
10. Cross-cutting: API call panel with redacted requests (base), trace envelope for every hop, mock mode toggle, presenter mode, one-click Reset (delete devices created by the tester, tracked by nickname prefix).

## 4. PingOne API calls (verified in code; line numbers in demo_api_server/services/mfaService.js)

Bases: auth = `https://auth.pingone.{region}/{envId}` (line 14-19; "NOT the OIDC /as path"); api = `https://api.pingone.{region}/v1/environments/{envId}` (line 22-26). Worker token: client_credentials, no scope param, Basic or post auth (line 28-60).

| Purpose | Call | Content-Type | Where |
|---|---|---|---|
| Resolve default policy | GET api/deviceAuthenticationPolicies | - | line 86. Docs say legacy /mfaPolicies 403s for the worker (policy-and-scopes.md). |
| Start device auth | POST auth/deviceAuthentications?expand=embedded `{user:{id},policy:{id}}` | application/json | line 219, 217 |
| Select device | POST auth/deviceAuthentications/{daId} `{selectedDevice:{id}}` | application/vnd.pingidentity.device.select+json | line 306-313 |
| Check OTP | POST auth/deviceAuthentications/{daId} `{otp}` | application/vnd.pingidentity.otp.check+json | line 397-399 |
| Check passkey | POST auth/deviceAuthentications/{daId} (assertion) | application/vnd.pingidentity.assertion.check+json | line 520 |
| Poll status | GET auth/deviceAuthentications/{daId} | - | line 465 |
| One-time OTP (no device) | POST auth/deviceAuthentications `{user:{id}, selectedDevice:{oneTime}}`, optional notification.template.variant; then otp.check+json | json | line 1241-1298 |
| List devices | GET api/users/{id}/devices?filter=(status eq "ACTIVE") | - | line 588 |
| Create device | POST api/users/{id}/devices `{type:EMAIL,email}` / `{type:TOTP}` / `{type:SMS,phone}` / `{type:FIDO2,nickname}` | application/json | lines 652, 699, 828, 998 |
| Activate TOTP | POST api/users/{id}/devices/{dev} `{otp}` | application/vnd.pingidentity.device.activate+json | line 745-757 |
| Activate SMS / Email | PUT api/users/{id}/devices/{dev} `{otp}` | device.activate+json | lines 913, 964 |
| Activate FIDO2 | POST api/users/{id}/devices/{dev} (attestation fields at root + origin) | device.activate+json | line 1180; fix per fido2-fix/FIDO2_FIX_INSTRUCTIONS.md |
| Delete device | DELETE api/users/{id}/devices/{dev} | - | line 1338 |
| Rename | PUT api/users/{id}/devices/{dev}/nickname `{nickname}` (PATCH on the device returns 403 from the AWS edge, memory note) | json | line 1361 |
| FIDO metadata | GET api/fidoDevicesMetadata/{aaguid} | - | line 622 |
| FIDO2 RP fix | GET api/fido2Policies; PUT api/fido2Policies/{id} setting relyingPartyId | json | line 1434-1461 |
| User contact | GET api/users/{id} | - | line 1318 |
| pi.flow sign-in (Postman collection) | GET auth/{env}/as/authorize?response_mode=pi.flow..., POST auth/{env}/flows/{flowId} (vendor types), GET auth/{env}/as/resume?flowId, POST auth/{env}/as/token | vendor | docs/PingOne Authentication v4 - MFA included.postman_collection.json |
| Transactional MFA | authorize pi.flow with acr_values=Step_Up + login_hint_token + request, then flows/{id} OTP check | vendor | same Postman file ("Transactional MFA") |

Scopes needed on the worker app (policy-and-scopes.md): p1:read:user, p1:update:user, p1:read:device, p1:create:device, p1:update:device, p1:delete:device; optional pairing-key scopes for mobile.

Discrepancies and gaps I found (do not copy blindly):
- SMS/Email activation uses PUT while TOTP/FIDO2 use POST, with the same vendor content type. Which is correct for SMS/email is UNVERIFIED live in this audit (the memory note only lists SMS sign-in and TOTP/passkey live-verified, not SMS enroll). The first live test must settle it; code both paths behind one `activateDevice()`.
- routes/mfaTest.js line ~1317 calls `require('../services/oauthService').getWorkerToken?.()` and grep finds no getWorkerToken in services/oauthService.js, so fido2-policy-diag sends an empty Bearer; and it hits /mfaPolicies, which the skill says 403s. That route is broken as written. Use deviceAuthenticationPolicies.
- Policy-by-policy decisions: not implemented. New code needed (GET deviceAuthenticationPolicies/{id} for the factor flags plus a probe deviceAuthentication per policy).
- Device ordering, policy create/clone, MFA Settings API (pairing max devices, lockout): documented in policy-and-scopes.md but not wired in mfaService.js. Memory: user raised mfaSettings.pairing.maxAllowedDevices 5 to 20 on 2026-10-17, so that setting is real; exact endpoint is UNVERIFIED here.
- Real push (MOBILE device) not implemented.

## 5. Live tenant vs mock mode

| Capability | Mock mode | Needs live PingOne |
|---|---|---|
| All UI, presenter, stories, diagrams, trace | yes | no |
| TOTP enroll + verify | yes (local secret, RFC 6238) | live path also automatable; no phone needed |
| SMS / Email OTP | yes (code displayed) | live delivers a real code; needs real phone/inbox |
| Passkey | partial: WebAuthn works in the browser against a local fake RP verifier (UNVERIFIED approach); realistic mode needs PingOne RP and matching origin | yes for true attestation checking |
| Push | mock phone only (exists) | real push not built |
| Per-policy decision | mock policy fixtures with realistic statuses | real shows the tenant's actual policies |
| Device list/rename/delete | mock store | live |
| Recovery S18 incl. forgot password | scripted mock | live forgot-password needs inbox |
| CIBA (optional) | cibaSimulatedService + consent mock phone exist | real CIBA needs the DaVinci flow + CIBA app (memory ai-demo2-ciba-pingone-davinci.md) |

Base requirement says mock mode is mandatory, and none exists for the PingOne device APIs today, so mockTenant.js (state machine for devices + deviceAuthentications statuses) is the main new server work.

## 6. Known traps (from memory notes and code)

1. P1 SMS: SMS sign-in verified live, but SMS CIBA sends and fails at the carrier when the user's mobile is the placeholder +19725551212 (ai-demo2-ciba-pingone-davinci.md). Need a real number. Failed SMS must not kill the approval in the DaVinci flow.
2. CIBA binding_message max 8 chars (invalid_binding_message); code uses a 6-char code (+2-char vertical code); full text goes in approval_summary. Endpoint is /as/cibaAuthorization (older skill text saying bc-authorize is stale; the pingone-mfa SKILL.md header still says bc-authorize is unrouted, which contradicts later success, so treat that header as stale too).
3. CIBA 500 still sends the email but PingOne drops the request: DaVinci "OOB Initiated Successfully" node needs userId = Find user matchedUser.id.
4. pi.flow DEVICE_SELECTION_REQUIRED: a user with several devices and no default is not a "needs a password" case (memory #1467). Stale flow status causes 400 "Invalid request for flow status" on user.lookup; persist advanced status.
5. PF MFA completes with MFA_COMPLETED + continueAuthentication, not COMPLETED (#1509); irrelevant if the tester is P1-only.
6. FIDO2: activation must be POST with device.activate+json, flat attestation + origin (fido2-fix). RP id/origin must match the fido2Policies relyingPartyId (ensureFido2RelyingParty, line 1429). PF passkey path needs FULL compatibility object (memory); skip.
7. Device rename must be PUT .../nickname; PATCH gives a misleading 403 "Invalid key=value pair ... Authorization header" (#1480).
8. LIMIT_EXCEEDED on enroll = pairing max devices; surface as "device_limit" (#1479).
9. New app-to-policy assignment takes about 5 s to propagate (a probe right after returns 400 "Invalid sign-on policy").
10. "Agent client credentials failed" text is misleading when the provider flag points the worker at the wrong token endpoint (#1476). In a standalone repo, keep one provider.
11. mfa-demo sample traps (skill): enable Email in the default device auth policy or enrollment fails with "Pairing device type EMAIL is not allowed"; needs real inbox; /flows needs both session cookies and (per AI-DEMO2 finding in sampleApps.js) is on auth.pingone.com; worker roles Identity Data Admin + Environment Admin; never grant Organization Admin. The authorize URL in the sample has no state/nonce/PKCE: do not copy that into a redirect flow.
12. Duplicate emails across demo users make email-based CIBA matching ambiguous; use username login_hint.
13. Test-hygiene: tester must tag devices it creates (nickname prefix) so Reset can delete only them; memory shows manual device cleanup was needed in AI-DEMO2.
14. Secret hygiene: mfaService.js logs a lot via mfaDebug and builds _debugHeaders; check it redacts Authorization before reuse (UNVERIFIED which). Forbidden-string gate: AI-DEMO2 env id 01d89b06... and client ids appear in memory notes and possibly code; none may be copied.

## 7. Build order and estimate

Assumes demo-kit-base exists (Phase 1 of the family plan). If it does not, add the base extraction to the critical path (not estimated here).

| Step | Work | Sessions |
|---|---|---|
| 1 | Repo from template; port mfaService.js to an injected-config mfaClient + port its tests; customer.config | 1 |
| 2 | mockTenant (devices, deviceAuthentications state machine, mock policies) + mock push + routes split from mfaTest.js | 1.5 |
| 3 | Web: Methods page with TOTP, SMS, Email cards (extract from MFATestPage.tsx), API-call panel, device table | 1.5 |
| 4 | Passkey card (passkeyCeremony.js, FIDO RP checks, mock verifier) | 1 |
| 5 | Policy decision matrix (new, live + mock) | 1.5 |
| 6 | Story engine data for S18 and S16, ReactFlow diagrams, presenter + talk track, Learn pack | 1.5 |
| 7 | doctor, Reset (tagged devices), setup script for worker app + roles, README/CI, forbidden-string gate | 1 |
| 8 | Live-tenant verification pass (settle SMS/email PUT vs POST, FIDO2 RP, TOTP step-up, policy probe) | 1 (needs the user's tenant and a real phone/inbox) |
| Optional | CIBA lab hooks (A4 territory), real push | +1 to 2 each |

Estimate: about 9 agent-sessions for v1 (mock-complete + live-verified for TOTP/email/SMS/passkey, push mock-only). Biggest assumption: demo-kit-base exists and provides the shell, auth, presenter and trace pieces. Second assumption: a PingOne sandbox env (not the AI-DEMO2 env) with Email, SMS, TOTP, FIDO2 enabled in a device auth policy is available for the live pass.

## 8. Not verified in this audit

- No code was run; no test was executed; no PingOne call made.
- mfa-demo sample source (not on disk), real push, MFA Settings endpoint, device ordering API, SMS/Email activate PUT-vs-POST, WebAuthn mock-RP approach, whether mfaLogger redacts Authorization, whether any AI-DEMO2 IDs are hard-coded in mfa files (not grepped for).
