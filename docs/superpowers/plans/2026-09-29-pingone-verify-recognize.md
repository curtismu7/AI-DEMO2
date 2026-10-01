# PingOne Verify and Recognize Implementation Plan

> **For agentic workers:** Implement the tasks in order, keep the BFF as the only holder of PingOne and Recognize service credentials, and stop at each external-configuration gate until the listed contract is confirmed. Use the repository's `executing-plans` workflow when carrying out this plan.

**Goal:** Add PingOne Verify identity proofing to the signed-in customer onboarding journey, then offer PingOne Recognize enrollment and Recognize biometric step-up for high-value transfer consent.

**Architecture:** App API operations go through authenticated BFF routes. The React UI opens PingOne Verify's hosted web experience and uses the official Recognize Web SDK directly. The BFF creates and checks Verify transactions using the PingOne Management API token provider already in the server. After an authoritative Verify `SUCCESS`, the browser may start Recognize. The BFF issues Recognize's short-lived user-authorization JWT and verifies SDK-signed enrollment/authentication results using the vendor's documented backend verification contract. Transfers continue to use the existing immutable consent challenge and OTP fallback; a browser callback alone never approves a challenge.

**Tech Stack:** Node.js 22+ / Express / CommonJS BFF, existing LMDB stores, React JSX UI, PingOne Verify REST API, PingOne Recognize Web SDK and its supported backend API.

**Spec:** This plan's “User flows,” “Trust and data rules,” and “Acceptance criteria” sections are the implementation specification.

## Scope and Assumptions

- Verify runs after the customer has a signed-in app account and a stable PingOne user ID, but before the customer can use actions that require proofing. Do not launch the Verify API from the public, unauthenticated registration form unless the implementation first establishes a trusted server-side user mapping.
- Recognize is an optional biometric factor after Verify succeeds. The first release supports live Web SDK enrollment and authentication. It does not transfer Verify selfies into Recognize IDV Bridge and does not offer self-service unenrollment until the supported Recognize deletion contract and its lifecycle effects are confirmed.
- High-value transfer consent uses the current server-side challenge and its OTP fallback. Web SDK support for displaying and signing transaction details must be proven from the Web SDK contract before claiming dynamic linking or payment SCA. The current PingOne dynamic-linking documentation is for Mobile SDK.
- This document is an implementation and deployment-readiness plan. It does not provision tenants, mutate PingOne, change application code, or deploy anything.

## Selected Integration Path

Use direct product integration in the existing React/BFF app; do not route these flows through PingOne DaVinci or its Orchestration SDK.

- **Verify:** The BFF calls the PingOne Verify REST API to create and read transactions. The React UI opens the returned Ping-hosted `webVerificationUrl` and resumes by polling the BFF. Ping's current standalone Verify SDK catalog lists Android and iOS SDKs; for this React web app, the plan uses the REST API and hosted web verification experience.
- **Recognize:** The React UI integrates the official PingOne Recognize Web SDK. The BFF issues the user-authorization JWT, validates signed SDK results, stores minimal enrollment state, and makes the transfer challenge decision.
- The browser necessarily navigates to the Verify hosted experience and the Recognize Web SDK communicates with the Recognize service. It never receives Management API credentials, Recognize API keys, private signing keys, or authority to mark a transaction verified/approved.
- DaVinci Verify and Recognize connectors remain a separate future architecture option, not a dependency or fallback in this implementation plan.

## Repository Context Before Implementation

- `demo_api_server/routes/recognize.js` currently accepts live/image enrollment and unenrollment requests. Do not keep the image payload path as the browser integration.
- `demo_api_server/services/recognizeService.js` and the existing Recognize branch in `transactionConsentChallenge.js` use a session/API shape and `X-API-Key` assumptions from an older design. Reconcile these with the current official Web SDK and vendor backend-operation contract before reusing them.
- `demo_api_ui/src/components/RecognizeOverlay.tsx` expects a custom `window.PingOneRecognize.init()` API and loads an unversioned `latest` CDN URL. Replace this with the supported, pinned Web SDK integration and its integrity controls.
- The BFF already exposes `/api/transactions/consent-challenge/:challengeId/verify-recognize` and an OTP fallback route. Reuse the established challenge lifecycle after reviewing its ownership, expiry, and state checks.
- `pingOneClientService.getManagementToken()` obtains Management API credentials server-side. Use this for Verify, subject to the worker app having the Verify permissions.
- No PingOne Verify workflow is currently present in the app.

## Implementation Status — 2026-09-29

### Verify

- Implemented the authenticated BFF create/status routes, Management API calls, per-user LMDB ownership records, disabled-by-default feature flag, and profile handoff/polling UI.
- The server accepts only the validated PingOne issuer and customer user UUID as the app-to-PingOne mapping. It validates PingOne's documented `_links.user.href` relation against the configured API region/environment and allowlists PingOne hosted verification domains. The browser cannot choose the user, redirect destination, or result status.
- Only an authoritative PingOne `transactionStatus.status === SUCCESS` result records `verifiedAt`. This does not enable Recognize until its backend validation contract is implemented.
- The feature remains off until Verify is enabled in the target non-production environment, a policy is selected, worker permissions are granted, and the canonical HTTPS app origin is configured.

### Recognize

- The old guessed `X-API-Key` endpoints, raw-image enrollment route, unversioned SDK loader, and admin API-key configuration UI have been retired. Legacy server routes fail closed, and a previously saved transfer mode resolves to the existing one-time OTP flow.
- The direct React Web SDK and BFF signed-result verifier are not enabled. Public Web SDK documentation available during implementation does not specify enough of the tenant's backend verification and one-operation binding contract to authorize enrollment or a transfer challenge safely.
- The repository-local `pingone/pingone-recognize/SKILL.md` still contains the retired protocol examples. Do not reuse its endpoints, headers, CDN URL, or callback assumptions for Tasks 4–5; this plan and `docs/ENV.md` carry the current gate.
- Before implementing Tasks 4–5, obtain the Recognize tenant/customer name, regional service URL, approved package/version access, user-authorization/JWKS setup, and exact signed-result validation contract. See “External Setup Gate” and `docs/ENV.md`.

### Deployment

- No PingOne tenant was provisioned or changed, no real identity evidence was used, and no environment has been enabled or deployed. Keep the deployment gates below in place.
- Focused Verify/contract-gate tests and the UI build are recorded below. Broader suite and hygiene results are also recorded there; resolve the noted runner and repository-baseline issues before treating this as rollout-ready.

## User Flows

### Verify before protected onboarding actions

1. The signed-in customer starts proofing from the onboarding/profile experience.
2. The BFF resolves the authenticated customer to the correct PingOne environment user ID and creates a Verify transaction using the configured Verify policy.
3. The UI opens the returned `webVerificationUrl`. On return, it treats URL/query state as navigation only and asks the BFF for status.
4. The BFF reads the authoritative Verify transaction. Only `transactionStatus.status === "SUCCESS"` sets the app's minimal verified marker. `FAIL`, `REQUESTED`, `IN_PROGRESS`, timeout, provider error, and `NOT_REQUIRED` do not unlock Recognize or proofing-gated actions.

### Recognize enrollment after Verify

1. The customer starts enrollment only after the BFF confirms Verify `SUCCESS`.
2. The BFF creates a short-lived, single-use Recognize user-authorization token for the same stable username passed to the Web SDK.
3. The pinned Recognize Web SDK captures the live enrollment. The UI sends only the SDK's signed transaction JWT to the BFF.
4. The BFF verifies the signature and required claims using the documented Recognize backend verification method. Only then does it save an enrollment marker.

### Recognize for transfer consent

1. Existing server logic creates and owns an immutable transfer consent challenge. It binds the current customer, transfer, amount, payee, and expiry.
2. If Recognize is selected and the customer has an active enrollment, the BFF issues the user-authorization token and starts the supported Web SDK authentication flow.
3. The UI returns the signed SDK result to the existing challenge verification route. The BFF validates it, verifies it belongs to the expected username and challenge context, and then completes the challenge.
4. A failed, rejected, expired, replayed, invalid, or unavailable Recognize attempt does not approve the transfer. It may pivot to the existing OTP fallback according to the current policy.

## Global Constraints: Trust and Data Rules

- App API requests use the existing authenticated BFF session. The browser never receives PingOne Management access tokens, worker credentials, Recognize API keys, or private signing keys.
- Use a stable, immutable customer identifier as the Recognize username. Confirm whether the canonical identifier is the PingOne user UUID or another persisted app subject; it must be identical in the SDK username and the BFF-issued JWT `sub`. Do not use mutable email as the identity key.
- Configure Recognize user authorization as `RemoteJWKSet` against a dedicated public JWKS endpoint, with the vendor enabling that customer configuration. Use a dedicated signing keypair and key ID; publish rotation-safe public keys and keep the private key in server-only secret storage.
- Recognize user-authorization JWTs use `aud: "authentication-service"`, matching `sub`, `iat`, and short `exp` (5–10 minutes); they are single-use. Enforce rate limits and prevent session-token replay.
- Verify's hosted `webVerificationUrl` and redirect are not proof. The BFF reads Verify's API status itself and associates each transaction ID with one authenticated app user/PingOne user.
- Recognize's success event and a client-supplied `enrolled: true` or `accepted: true` boolean are not proof. Verify SDK JWT signature, algorithm/key ID, issuer, time claims, stable subject, operation purpose, and challenge/transaction binding against the vendor's documented contract.
- Each transfer authentication must be cryptographically or vendor-session bound to one server-generated challenge/operation and be non-replayable. If the Web SDK result cannot establish that binding, keep Recognize disabled for transfer consent and use the existing OTP path.
- Keep Verify/Recognize documents, selfies, frames, base64 images, provider JWTs, access tokens, and API keys out of app persistence and logs. Persist only the IDs and minimum lifecycle state needed to check ownership and resume the flow. Do not echo upstream error bodies to the browser; normalize provider errors.
- Verify transactions default to a 30-minute lifetime and data collection to 15 minutes. `expiresAt` ends data collection; PingOne can continue processing submitted data after that time, so keep reading the provider status until terminal and retain pending ownership mappings. Prune terminal mappings after expiry. Apply the repository's canonical public origin from topology/config; never add a `localhost` OAuth/redirect URL.
- The BFF permits PingOne's standard regional Verify hosts or one exact, operator-configured custom Verify hostname. Never trust an unconfigured `webVerificationUrl` host.
- Do not call a flow payment SCA or dynamic linking unless the Web SDK's transaction-display/signing behavior and signed claims are documented and tested for the pinned SDK. The current docs describe Recognize dynamic linking under Mobile SDK.

## External Setup Gate

Complete these checks in a non-production PingOne/Recognize tenant before application integration is enabled. Read provisioning/reset scripts before any use; do not run them as part of this plan without an explicit implementation task.

1. Confirm the PingOne Verify service is enabled for the environment, the required `PING_ONE_VERIFY` bill-of-materials item is present, a Verify policy is configured, and the worker app has the least-privilege permissions (`idverifications:create:verifyTransactions` plus the required read permission).
2. Confirm every eligible app customer maps to exactly one PingOne environment user UUID. Decide the fail-closed behavior for missing, duplicate, disabled, or mismatched user mappings.
3. Confirm the Recognize customer name, regional authentication service URL, supported Web SDK package access, and exact currently approved package version. Current official setup documentation shows `@keyless/sdk-web` and `@keyless/sdk-web-components` version `3.1.0`; recheck before implementation and pin the version used.
4. Obtain the current Recognize Web SDK and backend API contract for enrollment-result verification, authentication-result verification, expected JWT claims/issuer/key set, key rotation, username mapping, and user removal. Record exact methods, endpoints, headers, request/response examples, timeout/retry rules, and tenant region before changing the current Recognize service.
5. Have Ping/Keyless enable user authorization with `RemoteJWKSet` and register the BFF's public JWKS URL. Confirm browser origin, camera permissions, CSP/connect-src requirements, package-feed credentials, and the SDK's accessibility/localization support.
6. Confirm the onboarding point, verified actions, proofing policy, and transfer threshold/fallback policy with the product owner. Do not silently treat manual approval or `NOT_REQUIRED` as an automated `SUCCESS`.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_server/services/verifyService.js` | Create | Authenticated PingOne Verify create/read calls; translate provider states into a small internal result. |
| `demo_api_server/services/lmdb/verifyTransactionStore.lmdb.js` | Create | Persist per-user Verify transaction ID, PingOne user ID, normalized status, expiry, and verified timestamp only. |
| `demo_api_server/routes/verify.js` | Create | Authenticated create/status routes with transaction ownership checks. |
| `demo_api_server/services/configStore.js` | Modify | Add the Verify policy ID and a default-off Verify feature flag; reuse the existing PingOne environment, region, and worker credentials. Add/retain dedicated server-only Recognize signing config only after the key-management contract is settled. |
| `demo_api_server/env.example` | Modify | Document new non-secret Verify config keys without values. |
| `docs/ENV.md` | Modify | Document config source, secrecy, and local setup requirements. |
| `demo_api_server/server.js` | Modify | Mount the Verify router and a public Recognize JWKS endpoint that exposes public keys only, if the existing server has no suitable endpoint. |
| `demo_api_server/routes/recognize.js` | Modify | Replace raw-image/client-assertion enrollment with start/complete APIs that use an authenticated identity and signed SDK result. |
| `demo_api_server/services/recognizeService.js` | Modify | Implement only contract-confirmed vendor calls; keep customer API key server-side and remove unsupported legacy assumptions. |
| `demo_api_server/services/recognizeJwtVerifier.js` | Create | Verify Recognize signed results using the confirmed vendor JWKS/backend contract, with bounded caching and key-rotation handling. |
| `demo_api_server/services/transactionConsentChallenge.js` | Modify | Gate Recognize by verified status/enrollment; bind signed authentication to existing challenge state; preserve expiry and OTP fallback. |
| `demo_api_server/routes/transactions.js` | Modify | Keep challenge ownership/authentication; accept the signed SDK result and return safe normalized errors. |
| `demo_api_server/routes/featureFlags.js` | Modify | Add/retain guarded Verify and Recognize options with a disabled-by-default rollout path. |
| `demo_api_ui/src/pages/HostedRegistrationPage.jsx` | Modify only if the authenticated post-registration state is implemented there | Add the first-run Verify handoff only after confirming this page has a trusted signed-in user mapping; otherwise use the authenticated customer profile route. |
| `demo_api_ui/src/components/Profile.js` | Modify | Show proofing/enrollment status and an action to start eligible flows; do not claim enrollment based on browser state. |
| `demo_api_ui/src/components/RecognizeOverlay.tsx` | Modify | Integrate the pinned official Web SDK component/API and send its signed result to the BFF. |
| `demo_api_ui/src/components/TransactionConsentModal.tsx` | Modify | Start the existing Recognize challenge flow and handle success/fallback/expiry without altering immutable transaction details. |
| `demo_api_server/tests/verifyService.test.js` | Create | Verify request construction, response normalization, expiry and provider failure handling. |
| `demo_api_server/tests/verifyRoutes.test.js` | Create | Route auth, owner isolation, state transitions, and untrusted browser-return behavior. |
| `demo_api_server/tests/recognizeJwtVerifier.test.js` | Create | Valid/invalid signatures, wrong key/algorithm/issuer/subject, expiry, replay, and key rotation. |
| `demo_api_server/tests/recognizeConsent.test.js` | Create or extend the current focused suite | Challenge binding, invalid signed results, fallback, expiry, and successful completion. |
| `demo_api_ui/src/pages/__tests__/HostedRegistrationPage.test.jsx` | Modify if onboarding UI is added there | Verify handoff and return/poll states. |
| `demo_api_ui/src/components/__tests__/TransactionConsentModal.*` | Create or extend the relevant test | Recognize SDK states and OTP fallback. |

## Implementation Tasks

### Task 1: Confirm contracts and identity mapping

**Files:** `demo_api_server/services/recognizeService.js`, `demo_api_server/services/transactionConsentChallenge.js`, `demo_api_server/routes/recognize.js`, `demo_api_ui/src/components/RecognizeOverlay.tsx`, `demo_api_server/services/pingOneClientService.js`, `demo_api_server/services/configStore.js` (read first).

- [ ] Record the app-user to PingOne-user mapping and the exact Recognize username/sub mapping. Confirm the authenticated route can obtain both without accepting either identity from the browser.
- [ ] Compare the existing Recognize endpoints and payloads with current official Web SDK/backend docs and the tenant contract. Reject an assumed endpoint if the vendor does not document it.
- [ ] Record exact enrollment/authentication result validation, transaction-data and one-operation/replay binding support for Web, user deletion semantics, and package access/version. Scope the first release to live Web SDK enrollment/authentication and omit unsupported deletion/dynamic-linking claims.
- [ ] Review Verify worker permissions, policy configuration, API region, status/read permission, user mapping, and required creation fields. Choose the minimum server-held values; do not persist submitted identity data.
- [ ] Keep this contract note in the PR description or implementation notes before proceeding to Tasks 2–5.

### Task 2: Add Verify transaction service and durable ownership

**Files:** `demo_api_server/services/verifyService.js`, `demo_api_server/services/lmdb/verifyTransactionStore.lmdb.js`, `demo_api_server/services/configStore.js`, `demo_api_server/tests/verifyService.test.js`.

- [x] Write failing service/store tests for create, read, allowed status normalization, missing policy/config, upstream timeout/error, per-user isolation, and expiry cleanup.
- [x] Implement Verify `POST /v1/environments/{environmentID}/users/{userID}/verifyTransactions` with `verifyPolicy.id` and a fixed canonical redirect URL. Use `pingOneClientService.getManagementToken()` and the environment/region already configured in the BFF.
- [x] Implement status read from the user-scoped `verifyTransactions/{transactionID}` resource. Map only documented terminal and pending states; preserve `SUCCESS` as the sole automatic enrollment gate.
- [x] Implement the LMDB record with app user ID, PingOne user ID, Verify transaction ID, normalized status, `expiresAt`, and `verifiedAt`. Do not store request PII, provider response bodies, images, or credentials.
- [x] Make local lookup require both the authenticated app user and their PingOne user ID. Expire records at the provider expiry plus only the minimum operational cleanup interval.
- [x] Run the Verify service/store tests after dependencies are installed.

### Task 3: Expose authenticated Verify API and onboarding handoff

**Files:** `demo_api_server/routes/verify.js`, `demo_api_server/server.js`, `demo_api_server/routes/featureFlags.js`, `demo_api_ui/src/pages/HostedRegistrationPage.jsx` or authenticated customer profile, its focused page test, `demo_api_ui/src/components/Profile.js`.

- [x] Write failing route tests for unauthenticated denial, create/status success, attempt to read another customer's transaction, forged return URL/status, terminal status, and expired transaction.
- [x] Add `POST /api/verify/transactions` returning `{ id, webVerificationUrl, expiresAt, status }`; derive user identity server-side and persist ownership before returning the handoff URL.
- [x] Add `GET /api/verify/transactions/:transactionId` returning only `{ id, status, expiresAt, verifiedAt, canEnrollRecognize }` after an authoritative provider read. Never accept a client status as an update.
- [x] Add authenticated profile UI that opens the returned hosted URL, resumes after redirect/reload, polls with bounded backoff, and renders pending/success/failure/expired states.
- [ ] Expose Recognize enrollment only after BFF-confirmed `SUCCESS` and its confirmed server-side result-validation contract; this remains gated in this implementation.
- [x] Add `pingone_verify_enabled` default false; avoid showing the flow when configuration is incomplete or feature is disabled. Keep public signup unauthenticated and do not pass unverified PII through it.
- [x] Run focused Verify BFF tests and the UI unit/build checks.

### Task 4: Replace the Recognize assumed contract with supported Web SDK flows

**Files:** `demo_api_server/services/recognizeService.js`, `demo_api_server/services/recognizeJwtVerifier.js`, `demo_api_server/routes/recognize.js`, `demo_api_server/server.js`, `demo_api_server/services/configStore.js`, `demo_api_server/.env.example`, `docs/ENV.md`, `demo_api_ui/src/components/RecognizeOverlay.tsx`, `demo_api_ui/src/components/Profile.js`.

- [ ] Write failing tests for Verify-gated start, stable username/sub, short-lived single-use customer JWT claims, signed SDK JWT acceptance/rejection, account mismatch, replay, and provider errors.
- [ ] Add authenticated `POST /api/recognize/enroll/start` that checks the BFF's verified marker, issues the official Recognize user-authorization JWT, and returns only the SDK bootstrap values required by the confirmed Web SDK contract.
- [ ] Add authenticated `POST /api/recognize/enroll/complete` that accepts only the SDK-signed transaction JWT. Validate it through the documented vendor endpoint or official verification keys, then persist the minimal enrollment marker. Do not accept image/base64 payloads or client booleans as proof.
- [ ] Add server-only `GET /.well-known/recognize-jwks.json` (or the canonical repo route) that publishes the active public key set and supports overlap during key rotation. Keep private keys in encrypted/server-only storage; never include them in config responses.
- [ ] Replace the unversioned `latest` script/custom `window.PingOneRecognize.init()` with the approved pinned package. Current docs show v3.1.0; use the version confirmed in Task 1. If CDN is required, pin a version and integrity hashes. Ensure CSP allows only required official domains.
- [ ] Add accessible camera permission, loading, denied, no-camera, retry, cancel, success, and failure states. Do not log face frames or JWTs.
- [ ] Do not add/delete an enrollment using unverified `/enrollments` assumptions. Retain the existing DELETE route only if the vendor contract confirms its endpoint, identity semantics, and biometric deletion behavior; otherwise hide/disable self-service removal for this first release.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/recognizeJwtVerifier.test.js tests/recognizeConsent.test.js --forceExit` and `cd demo_api_ui && npm run test:unit && npm run build`.

### Task 5: Bind Recognize to transfer consent and preserve fallback

**Files:** `demo_api_server/services/transactionConsentChallenge.js`, `demo_api_server/routes/transactions.js`, `demo_api_server/tests/recognizeConsent.test.js`, `demo_api_ui/src/components/TransactionConsentModal.tsx`, relevant UI tests.

- [ ] Write failing tests proving a recognized result cannot approve a different user's challenge, a different transaction, a changed amount/payee, an expired challenge, or a replayed challenge result.
- [ ] Require the existing challenge owner, pending state, recognized username, expiration, and signed SDK result to match before moving the challenge to approved.
- [ ] Require a one-time binding between the BFF challenge and the verified Recognize operation. If the current Web SDK cannot return or validate such a binding, disable the Recognize option for transfer challenges and leave the existing OTP route available.
- [ ] Reuse the server's existing OTP fallback only for the configured eligible failure/outage conditions. Do not convert invalid identity, replay, challenge mismatch, or other security violations into approval; deny and audit them through the existing safe audit path.
- [ ] Keep the transfer summary and challenge binding server-controlled. If the Web SDK cannot sign the amount/payee, describe Recognize as a biometric factor on the challenge and do not claim it cryptographically signs those details or satisfies payment SCA.
- [ ] Keep responses/errors normalized and ensure session-save failures cannot report success before challenge state is durably recorded.
- [ ] Run focused BFF consent tests and the relevant Vitest component tests; then run `cd demo_api_ui && npm run build`.

### Task 6: Rollout and deployment readiness

**Files:** `demo_api_server/CLAUDE.md` only if operational guidance changes, `docs/ENV.md`, deployment/config manifests that the implementation actually needs, and focused tests above.

- [ ] Add a non-production setup runbook containing exact config keys, worker permission, Verify policy, Recognize customer/JWKS setup, SDK version/integrity, allowed origins, and rollback switch. Never include secrets or real identity evidence.
- [ ] Verify `pingone_verify_enabled` and Recognize mode default off; enable Verify for internal/demo test users first, then broaden after operations confirm policy and result handling. Keep current OTP fallback available during the pilot.
- [ ] Exercise Verify initiated, approved, rejected, timeout, provider outage, wrong-user lookup, and browser-return tampering; exercise Recognize enroll, auth success/reject, camera denial, vendor outage, invalid/replayed JWT, and OTP fallback.
- [ ] Run `cd demo_api_server && CI=true npm test -- --forceExit`, `cd demo_api_ui && npm run test:unit && npm run build`, and repository checks required for touched surfaces. For any UI edit, preserve the project's emoji allowlist and run the UI build.
- [ ] Before running service checks, run `npm ci` in each service whose dependencies are missing; do not let `npx` install an unpinned toolchain.
- [ ] Deploy only to the local Docker stack under current repository policy. Do not run `docker compose` from the worktree; use `npm run serve:worktree here` when the shared stack must serve worktree code. Any remote production deployment needs separate explicit authorization and a production-specific release plan.

## Verification Record — 2026-09-30

- **Focused BFF:** `CI=true npx jest tests/verifyRoutes.test.js tests/verifyService.test.js tests/verifyTransactionStore.test.js tests/featureFlags.pingoneVerify.test.js tests/recognizeRoutes.contractGate.test.js src/__tests__/recognizeService.test.js src/__tests__/recognizeConsent.regression.test.js --runInBand --forceExit` — 7 suites, 40 tests passed. `node --check` passed for the changed BFF entry point, auth middleware, Verify route/service, and Recognize service.
- **Focused UI:** `npm run test:unit -- --run src/components/VerifyCard.test.jsx src/__tests__/FeatureFlagsPage.test.js` — 2 files, 17 tests passed. `npm run build` passed. Vite reported the existing missing local mkcert files and a large-chunk warning; the build completed successfully.
- **Full UI attempts:** Two full-suite runs were interrupted by the memory guard when its `ps` RSS-inspection command received SIGTERM, despite peak RSS remaining below the 4.00 GB limit (1.80 GB on the first run, 1.83 GB on the retry). The first stopped at batch 53/59; the retry stopped at batch 25/59 and Vitest then reported a closed worker channel. Both attempts had passing tests in completed batches, but neither completed the suite. The chained build from the first attempt was run separately and passed.
- **Full BFF attempt:** 1,129 suites passed; 5 suites failed and 2 were skipped (12,707 tests passed, 6 failed, 123 skipped). The five failed suites were rerun individually and each passed: scope integration (49), agent invoke (26), privilege facade link (21), runtime settings API (16), and rotation container paths (9). Treat the full run as flaky/inconclusive, not fully green.
- **Repository checks:** `npm run authz:verify` passed (81 use cases / 238 routes), and `npm run topology:verify` passed all 10 steps. `npm run hygiene:check` stopped at the mock-drift preflight with 1,744 findings; no hygiene pass is claimed.
- **Rendered contrast:** headless Chromium checked 8 Verify/profile text elements in each light and dark theme; no contrast failures were found.
- **Diff hygiene:** `git diff --check` passed. No PingOne tenant was provisioned or changed, and nothing was deployed.
- **Remaining rollout blockers:** Confirm the external setup gates, implement Tasks 4–5 only after the tenant-specific Recognize signed-result and one-operation binding contract is documented, resolve or classify the broader-check failures, and complete the rollout checklist before enabling either production flow.

## Acceptance Criteria

- Verify transaction creation/status calls use PingOne's documented user-scoped endpoints and server-held Management API credentials.
- A Verify result can only be attached to its authenticated owner, and only provider-reported `SUCCESS` unlocks proofing-gated Recognize enrollment.
- Recognize uses the official pinned Web SDK; the app has no unversioned `latest` SDK and accepts no raw image or client success boolean as enrollment/authentication proof.
- Every Recognize result is verified server-side using a vendor-confirmed key/endpoint contract and is bound to the expected user and operation. The customer authorization JWT is short-lived, single-use, and not exposed beyond the active SDK session.
- Transfer challenge state, ownership, transaction binding, expiry, and safe OTP fallback remain enforced by the BFF.
- No raw Verify/Recognize evidence, credentials, access tokens, or signed SDK JWTs are written to persistent app state or logs.
- Feature flags default off, non-production rollout and rollback are documented, focused tests pass, UI builds, and deployment follows local-only repository policy.

## Official References

- [Ping SDK catalog: current standalone Verify SDK platforms](https://developer.pingidentity.com/sdks.html)
- [Ping Orchestration SDK support matrix](https://developer.pingidentity.com/orchsdks/)
- [PingOne Verify introduction](https://developer.pingidentity.com/pingone-api/verify/introduction.html)
- [Create Verify Transaction API](https://developer.pingidentity.com/pingone-api/verify/verify-transactions/create-verify-transaction.html)
- [Verify Transactions API: status, expiry, and transaction model](https://developer.pingidentity.com/pingone-api/verify/verify-transactions.html)
- [PingOne Recognize Web SDK components](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-introduction-components.html)
- [PingOne Recognize Web SDK setup and integrity checks](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-guide-getting-started.html)
- [Recognize Web SDK user authorization](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-reference-user-authorization.html)
- [Recognize Web SDK enrollment and signed result handling](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-guide-enrollment.html)
- [Recognize authentication and step-up overview](https://docs.pingidentity.com/recognize/introduction/authentication.html)
- [Recognize JWT verification and key rotation guidance](https://docs.pingidentity.com/recognize/mobile-sdk/mobile-sdk-jwt-best-practice.html) (Mobile SDK reference; confirm the Web SDK's exact validation contract before implementation.)
- [Recognize dynamic linking guide (Mobile SDK)](https://docs.pingidentity.com/recognize/mobile-sdk/mobile-sdk-dynamic-linking.html)
