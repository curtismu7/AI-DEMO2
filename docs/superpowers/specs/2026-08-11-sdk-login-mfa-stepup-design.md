# SDK Login: Step-Up MFA to Reveal Decoded Claims

Date: 2026-08-11
Status: Approved (design), pending implementation

## Problem

`/sdk-login` demonstrates the Ping Identity JS SDK (`@forgerock/oidc-client`)
doing browser-side PKCE login and token revocation, but stops there. It's
"light" — one flow, no access-control story. It doesn't yet show PingOne
enforcing anything beyond initial authentication.

## Goal

Add a depth-first extension to the existing page: after SDK sign-in, gate a
new sensitive action (viewing decoded ID-token claims) behind a live
PingOne MFA step-up (email OTP), enrolled on the fly. This demonstrates the
SDK obtaining a token *and* PingOne enforcing step-up before a sensitive
read — a real access-control narrative, not just plumbing.

Breadth (more independent capability panels — device management, PingOne
Protect risk signals, FIDO2/passkey enroll, token introspection) is
explicitly parked for a later spec; this design covers only the step-up
narrative end to end.

## Non-goals

- No changes to the BFF's main banking login/session flow.
- No new PingOne MFA backend logic — reuse existing `mfaService.js` /
  `routes/mfa.js` endpoints as-is (with one small fallback fix, see below).
- No new npm dependency for JWT decoding — hand-roll the base64url parse
  (page already avoids adding SDK weight beyond `@forgerock/oidc-client`).

## Narrative / UX

1. User signs in via the existing SDK flow (unchanged). The raw
   `client.token.get()` JSON continues to display exactly as it does today.
2. A new card appears below it: **"Decoded ID token claims — step-up
   required"**, locked, with a "Reveal decoded claims" button.
3. Click → the page requests an email OTP (`POST /api/mfa/enroll/email`)
   using the user's own SDK-issued access token as a Bearer credential.
   PingOne emails a live OTP.
4. An OTP input appears. User enters the code → `POST
   /api/mfa/enroll/email/verify`.
5. On success, the card unlocks and renders the decoded ID-token JWT
   payload (via the existing `JsonHighlight` component, same as the raw
   token blob above it).
6. Any failure (bad code, expired, rate-limited, network) renders inline
   in the card as an error message — it does not hang silently. (This
   mirrors the fix just shipped for the `/sdk-login/callback` page, where a
   StrictMode bug swallowed errors and left the page stuck forever.)

## Architecture

```
Browser (SdkLoginPage.jsx)
  │  Authorization: Bearer <SDK access token>
  ▼
POST /api/mfa/enroll/email        (existing route, demo_api_server/routes/mfa.js)
POST /api/mfa/enroll/email/verify (existing route)
  │
  ▼
mfaService.js → PingOne MFA API (worker token, existing pattern)
```

No new backend routes. The SDK sandbox's browser-held access token
(already validated by `authenticateToken` for every other endpoint this
page calls) is reused as the Bearer credential for these two MFA calls.

### Required backend fix (small, scoped)

`authenticateToken` (`middleware/auth.js`) already decodes a Bearer token
into `req.user = { sub, email, ... }` when there's no session. But
`routes/mfa.js`'s `enroll/email` and `enroll/email/verify` handlers read
`req.session.user?.oauthId || req.session.user?.id` to find the PingOne
user id — which is `undefined` for a Bearer-only caller like this sandbox
(it has no BFF session). Fix: extend the fallback chain to include
`req.user?.sub`:

```js
const userId = req.session.user?.oauthId || req.session.user?.id || req.user?.sub;
```

Two call sites in `routes/mfa.js` (`enroll/email`, `enroll/email/verify`).
This is the only backend code change; everything else in `mfaService.js`
and the PingOne call shape is untouched.

## Frontend components

All changes live in `demo_api_ui/src/pages/SdkLoginPage.jsx` (the existing
single-file page — no new files needed given its current size and style).

- New sub-component `StepUpClaimsPanel` — rendered inside the existing
  `signed-in` card, below the current `client.token.get()` /
  `client.user.info()` blocks.
- New local state on `SdkLoginPage`:
  - `claimsUnlocked` (bool)
  - `mfaDeviceId` (string | null) — returned from `enroll/email`
  - `otpValue` (string) — controlled input
  - `mfaBusy` (bool)
  - `mfaError` (string | null)
- New helper `decodeJwtPayload(idToken)`: split on `.`, base64url-decode
  the middle segment, `JSON.parse`. No library.
- Styling: reuse the existing `makeStyles(C)` palette/tokens already on
  the page (`card`, `btn`, `btnPrimary`, `banner`, etc.) — no new design
  system.

## Data flow detail

```
[Reveal decoded claims] click
  → mfaBusy = true
  → POST /api/mfa/enroll/email
      headers: { Authorization: `Bearer ${accessToken}` }
      body: { email: userInfo.email }
  → on success: mfaDeviceId = data.deviceId; show OTP input
  → on failure: mfaError = message; mfaBusy = false

[Verify] click (with otpValue filled)
  → mfaBusy = true
  → POST /api/mfa/enroll/email/verify
      headers: { Authorization: `Bearer ${accessToken}` }
      body: { deviceId: mfaDeviceId, otp: otpValue }
  → on success: claimsUnlocked = true; render decodeJwtPayload(tokens.idToken)
  → on failure (e.g. INVALID_OTP → 422): mfaError = message; mfaBusy = false;
    OTP input stays so user can retry
```

`accessToken` comes from the already-loaded `tokens` state (`client.token.get()`
result) that the page holds for the signed-in view.

## Error handling

- Every fetch failure (network, non-2xx) sets `mfaError` and re-enables the
  triggering button — never leaves the panel in a stuck "loading" state.
  This is the same lesson as the callback-page fix: always resolve to a
  visible state, never let a promise settle into limbo.
- 401 on either MFA call (e.g. token expired mid-flow) shows a specific
  message directing the user to sign in again, distinct from a generic OTP
  failure.

## Testing

- **Unit (vitest):** new test file `SdkLoginPage.stepUpClaims.test.jsx` (or
  extend an existing `SdkLoginPage` test if one exists) covering:
  - locked → click reveal → OTP input appears (mock `fetch` success)
  - OTP submit success → claims render
  - OTP submit failure (422) → error shown, input still editable
  - network failure on either call → error shown, button re-enabled
- **Manual/live:** exercise the full flow against the real PingOne
  environment (`local.ping-devops.com:4000/sdk-login`) — sign in, reveal
  claims, receive real OTP email, verify, confirm claims render.
- **Build gate:** `npm run build` must stay green (per `demo_api_ui/CLAUDE.md`).

## Parked ideas (future specs, not designed here)

- Device management panel: list (`GET /api/mfa/devices`) + revoke
  (`DELETE /api/mfa/devices/:deviceId`).
- PingOne Protect risk signal display alongside login.
- FIDO2/passkey enrollment demo (`enroll/fido2-init` / `-complete` already
  exist server-side).
- Token introspection / revocation-endpoint explorer as its own card.

These are independent, additive panels — each should get its own short
design pass when picked up, per the "breadth, staged" decision.
