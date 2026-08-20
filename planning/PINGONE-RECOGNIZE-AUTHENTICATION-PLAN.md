# PingOne Recognize Authentication Implementation Plan

Status: planned for later development and deployment  
Target: AI-DEMO2 React UI, Node BFF, local Docker, and PingAWS Kubernetes  
Assumption: PingOne Recognize facial biometrics will act as a second authentication factor after PingOne primary authentication.

## Objective

Add PingOne Recognize to the user authentication journey without exposing OAuth tokens to the browser or allowing browser-controlled success. A user should complete PingOne primary authentication and then pass Recognize liveness/recognition before the BFF activates the application session.

Recognize can also be reused later as step-up authentication for sensitive agent or MCP operations.

## Authoritative documentation

- [Web SDK overview](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-getting-started.html)
- [Components](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-introduction-components.html)
- [Integration flows](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-introduction-integration-flows.html)
- [Web SDK installation](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-guide-getting-started.html)
- [Prerequisites](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-prerequisites.html)
- [Enrollment](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-guide-enrollment.html)
- [Authentication](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-guide-authentication.html)
- [User authorization](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-reference-user-authorization.html)

## Recommended architecture

```text
Browser              BFF                  PingOne             Recognize
   |                   |                      |                    |
   |-- Start OIDC ---->|-- Authorization --->|                    |
   |<---------------- Primary login -----------------------------|
   |-- OAuth callback->|                      |                    |
   |                   | hold tokens pending |                    |
   |<-- Recognize UI --|                      |                    |
   |-- camera frames -------------------------------------------->|
   |<-- transactionJwt -------------------------------------------|
   |-- transactionJwt ->|-- verify server-to-server ------------->|
   |                   |<-- verified identity/liveness -----------|
   |                   | activate session                         |
   |<-- authenticated dashboard ----------------------------------|
```

The Recognize SDK runs in the browser and sends biometric frames directly to the Recognize Authentication Service. The BFF issues short-lived user-authorization tokens and verifies the returned `transactionJwt`. OAuth and application tokens remain server-side.

## Security invariants

- Successful OIDC must not activate a session when Recognize is required.
- Never accept a browser boolean such as `recognized: true`.
- Verify the Recognize `transactionJwt` server-to-server.
- Validate signature, issuer, audience, subject, operation, expiry, nonce, and one-time use.
- Keep pending OAuth tokens only in the server-side session.
- Never log camera frames, biometric templates, complete authorization JWTs, or transaction JWTs.
- Enrollment requires an already authenticated user.
- Authentication and enrollment transactions expire and cannot be replayed.
- Existing authentication remains unchanged when `RECOGNIZE_ENABLED=false`.

## Phase 1: Provision Recognize

Obtain and validate:

- `CLOUDSMITH_TOKEN`
- `CUSTOMER_NAME`
- `KEYLESS_AUTHENTICATION_SERVICE_URL`
- `IMAGE_ENCRYPTION_KEY_ID`
- `IMAGE_ENCRYPTION_PUBLIC_KEY`
- Recognize transaction-verification endpoint/JWKS configuration
- Test users licensed and enabled for Recognize

Configure Recognize user authorization as `RemoteJWKSet`. Publish a BFF-owned JWKS endpoint and have the BFF issue short-lived, single-use JWTs containing:

```json
{
  "sub": "stable-recognize-user-id",
  "aud": "authentication-service",
  "iat": 1776720000,
  "exp": 1776720300
}
```

The `sub` must exactly match the username passed to the SDK. Use a five-to-ten-minute maximum lifetime.

## Phase 2: BFF configuration and service

Add configuration similar to:

```dotenv
RECOGNIZE_ENABLED=false
RECOGNIZE_REQUIRED_FOR_LOGIN=false
RECOGNIZE_CUSTOMER_NAME=
RECOGNIZE_AUTH_SERVICE_URL=
RECOGNIZE_IMAGE_KEY_ID=
RECOGNIZE_IMAGE_PUBLIC_KEY=
RECOGNIZE_JWKS_URI=
RECOGNIZE_EXPECTED_ISSUER=
RECOGNIZE_EXPECTED_AUDIENCE=
RECOGNIZE_USER_AUTH_PRIVATE_KEY=
RECOGNIZE_USER_AUTH_KEY_ID=
RECOGNIZE_TRANSACTION_TTL_SECONDS=300
```

Create `demo_api_server/services/recognizeService.js` to:

- Map a PingOne user to a stable Recognize username.
- Issue single-use SDK authorization JWTs.
- Generate transaction data and nonces.
- Verify Recognize transaction JWTs.
- Prevent transaction replay.
- Normalize results without retaining biometric data.

Private keys belong only in local encrypted secrets and Kubernetes secrets. Browser-safe configuration may include the customer name, service URL, public image-encryption key, key ID, and short-lived user authorization token.

## Phase 3: BFF routes

Create `demo_api_server/routes/recognize.js` with:

| Route | Purpose |
| --- | --- |
| `GET /api/recognize/config` | Return enabled status and browser-safe SDK configuration. |
| `POST /api/recognize/enrollment/start` | Require login and create a single-use enrollment transaction. |
| `POST /api/recognize/enrollment/complete` | Verify the transaction JWT and record enrollment. |
| `POST /api/recognize/authentication/start` | Require pending primary authentication and create an authentication transaction. |
| `POST /api/recognize/authentication/complete` | Verify the transaction and promote the pending BFF session. |
| `GET /api/recognize/status` | Return `not_enrolled`, `enrolled`, `pending`, `verified`, or `locked`. |
| `GET /.well-known/jwks.json` or a scoped equivalent | Publish the public key used to verify SDK authorization JWTs. |

Apply rate limiting, CSRF/session binding, correlation IDs, short transaction expiry, and one-time nonce consumption.

## Phase 4: Pending authentication state

Modify the user OAuth callback carefully:

1. Complete the PingOne authorization-code exchange.
2. Validate tokens exactly as today.
3. Preserve current behavior when Recognize is disabled or not required.
4. When Recognize is required, store tokens in `req.session.pendingRecognizeAuth` rather than active `oauthTokens`.
5. Redirect to `/recognize/authenticate`.
6. After verified Recognize completion, move tokens into active session state.
7. Record verification context and clear all pending state.
8. Redirect to the sanitized original `returnTo` path.

Pending authentication should expire after approximately five minutes. Logout, cancellation, authentication failure, and expiry must destroy the pending token state.

## Phase 5: Enrollment UI

Install `@keyless/sdk-web-components@3.0.0` from the authorized Cloudsmith repository and add `/recognize/enroll`.

Use `<kl-enroll>` for the first implementation. It provides camera permission, camera selection, framing guidance, frame submission, and terminal events with less custom code than the headless SDK.

Enrollment flow:

1. User signs in with existing PingOne authentication.
2. User explicitly selects **Enroll facial authentication**.
3. Show camera, privacy, fallback, and recovery information.
4. Request a BFF-created enrollment transaction.
5. Mount `<kl-enroll>` with the returned authorization/configuration data.
6. Submit the returned `transactionJwt` to the BFF.
7. Show success only after server verification.

Do not activate the camera automatically on ordinary page load.

## Phase 6: Authentication UI

Add `/recognize/authenticate` using `<kl-auth>`.

The page should:

- Explain that primary authentication succeeded and biometric verification remains.
- Start camera access only after explicit user action.
- Display frame-quality and liveness guidance.
- Submit the returned transaction JWT to the BFF.
- Enter the dashboard only after server verification.
- Offer a policy-controlled fallback to an existing MFA method.
- Treat cancellation, camera denial, timeout, and SDK failure as unauthenticated states.

## Phase 7: Browser and ingress requirements

The SDK must load as JavaScript modules and the Vite build must support its WebAssembly resources.

If multi-threading is enabled, Recognize requires:

```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

Apply these headers initially only to Recognize routes. Global COEP/COOP can affect OAuth popups, embedded content, diagnostics, and cross-origin assets.

Verify:

- Local HTTPS at `local.ping-devops.com:4000`
- Public HTTPS at `ai-demo.ping-devops.com`
- WebSocket upgrade through local nginx and PingAWS ingress
- Camera permissions on desktop and mobile browsers
- WASM and worker asset paths in production builds

## Phase 8: Authentication policy and rollout

Support these server-side modes:

```text
off
optional-enrollment
required-for-selected-users
required-for-admins
required-for-all-users
step-up-only
```

Recommended rollout:

1. Optional enrollment.
2. Required login for one dedicated demo user.
3. Required login for administrators.
4. Step-up for selected sensitive agent/MCP operations.
5. Wider rollout only after fallback and recovery testing.

Do not enforce policy from a browser-only feature flag.

## Phase 9: Assurance and token claims

For the application-level implementation, store server-side context such as:

```json
{
  "primary": "pingone_oidc",
  "recognize": {
    "verified": true,
    "verifiedAt": "2026-08-20T20:30:00Z",
    "operationId": "example-operation-id",
    "assurance": "biometric_liveness"
  }
}
```

Do not modify or reinterpret the PingOne-issued ID token.

If downstream services require authentic PingOne-issued `amr` or `acr` claims that include Recognize, move Recognize orchestration into the PingOne/DaVinci authentication journey in a later phase. The application-level gate is appropriate for the MVP but cannot add claims to an already-issued PingOne token.

## Phase 10: Demo and audit evidence

Add these events to the authentication trace:

- Primary PingOne authentication completed.
- Recognize authorization token issued.
- Camera permission granted or denied.
- Recognition/liveness operation completed.
- Transaction JWT verified by the BFF.
- Pending session promoted to authenticated.
- Failure, cancellation, expiry, lockout, or fallback selected.

Audit only:

- PingOne user ID
- Recognize operation ID
- Enrollment/authentication action
- Outcome category
- Timestamp
- Correlation ID
- Authentication policy

## Test plan

### BFF unit and integration tests

- Correct authorization JWT claims, signing key, and expiry.
- Transaction signature/JWKS verification.
- Issuer, audience, subject, operation, expiry, and nonce validation.
- Replay rejection.
- Pending-session expiry and cleanup.
- Enrollment-required and fallback policy behavior.
- OAuth succeeds but session remains inactive until Recognize succeeds.
- Browser-provided success flags cannot bypass verification.

### UI unit tests

- Camera-consent instructions.
- Enrollment success and failure.
- Authentication success and failure.
- Camera denied and no-camera states.
- Timeout, cancellation, and fallback behavior.
- Accessible labels, focus order, keyboard use, and error announcements.

### Playwright tests

- Mock successful enrollment.
- Mock successful Recognize authentication.
- Invalid and expired transaction JWTs.
- Replayed transaction JWT.
- Subject mismatch.
- OAuth success plus Recognize failure leaves the dashboard inaccessible.
- Recognize success activates the session.
- `RECOGNIZE_ENABLED=false` preserves the existing login flow.

### Real-device validation

- Chrome and Safari desktop.
- Chrome and Safari mobile.
- Multiple cameras.
- Revoked camera permission.
- Low light and poor framing.
- Network interruption during capture.
- Local Docker and PingAWS WebSocket behavior.

## Deployment plan

1. Provision and validate a non-production Recognize customer.
2. Add encrypted local configuration and Kubernetes secrets.
3. Deploy BFF routes with `RECOGNIZE_ENABLED=false`.
4. Deploy the enrollment UI behind an admin/demo-only flag.
5. Validate one test user's enrollment in local Docker.
6. Validate enrollment and authentication in PingAWS.
7. Enable `optional-enrollment` for demo users.
8. Enable `required-for-selected-users` for one controlled account.
9. Validate fallback and rollback.
10. Enable broader policy only after audit and recovery checks pass.

Rollback is configuration-first: set `RECOGNIZE_ENABLED=false` and restart the BFF/frontend if necessary. Existing PingOne authentication must remain operational.

## Recommended delivery order

1. Tenant credentials and transaction-verification spike.
2. BFF authorization-token and transaction-verification service.
3. Enrollment page.
4. Standalone post-login Recognize authentication.
5. Pending-session gate in the OAuth callback.
6. Fallback and recovery.
7. Audit and authentication trace.
8. Selected-user rollout.
9. DaVinci integration if PingOne-issued `amr`/`acr` is required.

## Completion criteria

- A selected user cannot access the dashboard after primary login until Recognize succeeds.
- The browser never receives active application OAuth tokens.
- Every Recognize completion is verified by the BFF and bound to one user/session/nonce.
- Replayed, expired, mismatched, or forged transactions fail closed.
- Enrollment and authentication work in local Docker and PingAWS.
- Camera denial and Recognize outage have an explicit policy-controlled fallback.
- Disabling Recognize restores the current authentication flow without code rollback.

