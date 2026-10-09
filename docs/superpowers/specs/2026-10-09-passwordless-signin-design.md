# Passwordless sign-in with PingOne MFA devices — design spec

Date: 2026-10-09
Status: approved in chat (staging + approach A); this document pins the details for P1.
Companion plan: `docs/superpowers/plans/2026-10-09-passwordless-signin.md` (written after spec review).

## Problem

The pi.flow sign-in modal (`demo_api_ui/src/components/PiFlowSignInModal.jsx`) always asks for a password first. A user with a registered PingOne MFA device (email/SMS OTP, passkey) could sign in with the device alone — passwordless — but the flow never offers it. The passkey and OTP steps already work *after* the password; the missing piece is starting the flow's device verification without the password leg.

## Goal

In the sign-in modal, a user can choose "Use a device instead" (username only → device verification → signed in). On the device step, "Use your password instead" returns to the password form — the password fallback is always one click away, both directions.

## Non-goals

- PingFederate passwordless (P3 — separate stage; the modal already routes PF MFA to the hosted page).
- Device-selection UI when a user has multiple devices (P2 — until then a multi-device flow response hits the generic snap-back).
- New feature flag (the modal only mounts when pi.flow is on, same as the passkey/OTP steps).
- Changes to `/callback`, PKCE, nonce, or session creation.

## Approach (chosen: A — extend the shared pi.flow driver)

`services/piFlowDriver.js` is the shared driver for user + admin routers. It already posts `usernamePassword.check` and branches on flow status via `respondAfterPiFlowStep` (passkey/OTP handled, everything else `fallback:true`). PingOne's pi.flow accepts a username-only step (`application/vnd.pingidentity.username.check+json`, body `{ username }`); after it, the flow moves to the same device statuses the post-password path already drives.

Rejected:
- **Probe-first** (pre-check endpoint opening a throwaway flow to test policy fit): doubles flow opens, needs username→PingOne-id resolution with a worker token pre-auth, buys nothing over snap-back.
- **Device-authentication grant** (`/deviceAuthentications`, as `mfaService` does for step-up): lives outside the OAuth flow; PKCE/callback/session plumbing would have to be reinvented.

## Stage P1 — PingOne passwordless in the modal (this spec's scope)

### Server

1. **`piFlowDriver.handlePasswordlessStart(req, res)`** (new, in `makePiFlowHandlers`):
   - `openPiFlowOrReject` guard (same as the other steps).
   - PingFederate pending → `409 { error: 'pi_flow_step_unsupported' }` (same guard the assertion/OTP steps use).
   - Validates `username` (string, non-empty) → else `400 { error: 'invalid_request' }`.
   - Posts `{ username }` with content type `application/vnd.pingidentity.username.check+json` to the open flow.
   - Response branches through the **existing** `respondAfterPiFlowStep`:
     - `OTP_REQUIRED` → `{ step: 'otp' }` (modal already renders it; `/pi-flow/otp` already drives it)
     - `ASSERTION_REQUIRED` + options → `{ step: 'passkey', ... }` (modal already renders it; `/pi-flow/assertion` already drives it)
     - `USERNAME_PASSWORD_REQUIRED` or any other status → `409 { error: 'passwordless_unavailable', message: 'This account requires a password. Sign in with your password.' }`
   - Errors map `502 { error: 'pi_flow_failed' }` like every other step.
2. **Route** in `routes/oauthUser.js` next to the other three: `router.post('/pi-flow/passwordless', piFlowHandlers.handlePasswordlessStart)`.
   The admin router (`routes/oauth.js`) gets the same one-liner — the handler is provider-shared; PF pending 409s inside the handler.

### UI (`PiFlowSignInModal.jsx`)

- New state `step: 'device'`: username-only form (autofocus username, prefilled from the password step's value if the user typed one).
- Password form gains a ghost link "Use a device instead" → switches to `device` step.
- Device form gains a ghost link "Use your password instead" → switches back to `password` (username preserved, password kept as-is so nothing is re-typed).
- Device submit: `POST /pi-flow/passwordless`. `409 passwordless_unavailable` → show the message and return to the password step (never dead-end). `otp`/`passkey`/`redirectTo` handled exactly as the existing branches.
- Admin role: same modal, `apiForRole()` already picks the router — no extra work.
- Provider check: `begin()` already falls back for PF when MFA is requested; for passwordless the handler's 409 covers a PF-provider flow (the link can stay visible; snapping back is the designed behavior).

### What will NOT break (REGRESSION_PLAN §1 rows: OAuth user login, admin role detection, TopNav session actions)

- The password path (`/pi-flow/credentials`) is untouched — no handler or route changes.
- `respondAfterPiFlowStep` gains no new branch; passwordless reuses the existing two.
- Admin 4-signal role detection, callback, PKCE state cookie: untouched.
- The modal's password step remains the default on mount.

### Tests

- **Driver/route (jest)** — extend `tests/oauthUserPiFlow.test.js`:
  - happy path: username-only → `OTP_REQUIRED` → `{ step: 'otp' }`
  - passkey path: → `ASSERTION_REQUIRED` → `{ step: 'passkey', publicKeyCredentialRequestOptions }`
  - policy says password: → `USERNAME_PASSWORD_REQUIRED` → 409 `passwordless_unavailable`
  - PF pending → 409 `pi_flow_step_unsupported`
  - empty username → 400; no open flow → 409 `pi_flow_not_started`
- **Modal (vitest)** — new spec next to `PiFlowSignInModal.test.jsx`:
  - renders password form by default; link switches to device form and back
  - device submit posts to `/pi-flow/passwordless`; 409 message + return to password
  - admin API path used when role is admin
- **Live drive** (after deploy): device-first sign-in with the demo user's enrolled email device, then the snap-back path.

### Success criteria

- A user with an enrolled email/SMS device signs in in the modal with username + device code only — no password ever typed.
- The password path is byte-for-byte unchanged (same handlers, same tests green).
- Snap-back never dead-ends: any unexpected flow status returns the user to the password form with a message.
- Full UI suite + UI build green; scoped jest suites green; live drive of both paths.

## Stage P2 — device selection + policy copy (one-liner rider)

Drive `DEVICE_SELECTION_REQUIRED`: the flow body lists devices; the modal renders a picker; a `POST /pi-flow/device` selection step continues the flow (same driver pattern). Replace the generic snap-back message with policy-specific copy. Skipped until P1 lands and a multi-device user exists to test against.

## Stage P3 — PingFederate passwordless (one-liner rider)

PF's flow shapes (`/pf-ws/authn/flows/{id}`, `checkUsernamePassword` analogues) behind the same UI. The modal's PF MFA detour to the hosted page is deliberate today; P3 replaces it per method after verifying PF's username-only + device statuses. Untouched until P1 proves the PingOne path.
