---
name: pingone-recognize
description: 'PingOne Recognize biometric face authentication for the Super Banking demo. USE FOR: Recognize WebSDK integration, face enrollment (WEB_ENROLLMENT capability), face authentication (WEB_AUTHENTICATION capability), enroll-from-image (TRUSTED_SOURCE / SELFIE / DOCUMENT scenarios), unenroll, recognizeService.js, RecognizeOverlay.tsx, RecognizeEnrollCard.tsx, hitl_consent_mfa_mode=recognize, verify-recognize and recognize-fallback BFF routes, OTP fallback chain, RECOGNIZE_API_KEY / RECOGNIZE_TENANT_NAME config, SDK CDN script loading, sessionToken lifecycle, Recognize REST API endpoints. DO NOT USE FOR: PingOne MFA device lifecycle (use pingone-mfa); OTP/onetime path internals (use hitl-consent); OAuth/session (use oauth-pingone); BFF session cookie patterns (use bff-sessions).'
argument-hint: 'Describe the Recognize operation (e.g. initiate face auth session, enroll user, handle SDK error, fallback to OTP)'
---

# PingOne Recognize — Super Banking demo

> **Emoji rule:** only `⚠️`, `✅`, `❌` anywhere in this repo.

---

## When to Use

- Integrating or debugging PingOne Recognize biometric face authentication (WebSDK, face enrollment, face authentication)
- Working with `recognizeService.js`, `RecognizeOverlay.tsx`, `RecognizeEnrollCard.tsx`, or the BFF Recognize routes
- Configuring `hitl_consent_mfa_mode=recognize`, `RECOGNIZE_API_KEY`, `RECOGNIZE_TENANT_NAME`, or sessionToken lifecycle
- Implementing enroll-from-image (`TRUSTED_SOURCE`/`SELFIE`/`DOCUMENT` scenarios) or the OTP fallback chain

## When NOT to Use

- PingOne MFA device lifecycle (SMS, TOTP, FIDO2, push) — use `pingone-mfa` instead
- OTP/onetime path internals for non-Recognize consent — use `hitl-consent` instead
- OAuth/session flows — use `oauth-pingone` or `bff-sessions` instead

## Overview

PingOne Recognize is a biometric face authentication service by Keyless (now part of Ping Identity). In this demo it is wired as the fourth `hitl_consent_mfa_mode` value (`recognize`). When selected, a face scan replaces OTP as the HITL consent verification step. Enrollment is managed from the Profile page.

**This feature is PoC-grade.** Recognize's DaVinci connector is explicitly marked proof-of-concept by Ping PM. The WebSDK path used here is the more stable option for demos.

---

## Tenant Access

| Resource | URL |
|---|---|
| Customer dashboard (API keys, config) | `https://sdk-customer-dashboard.eks.core-production.saas-us-east.keyless.technology/` |
| Playground (enrollment + auth experiments) | `https://playground.eks.core-production.saas-us-east.keyless.technology/customers/ping_us/authentication` |

**Dashboard login:** use your Ping email + "Reset password" flow.  
**Playground shared password:** in the team vault — `vault get RECOGNIZE_PLAYGROUND_PASSWORD`.  
**API keys:** Dashboard → Access Control → Secret API Key → Create Secret API Key.

---

## Required Environment Variables

```bash
RECOGNIZE_API_KEY=        # Secret API key from dashboard → Access Control
RECOGNIZE_TENANT_NAME=    # Customer/tenant slug (e.g. ping_us)
# RECOGNIZE_BASE_URL=     # Optional — defaults to US region (see regions below)
```

**Regions:**

| Region | Base URL |
|---|---|
| US (default) | `https://authentication-service.eks.core-production.saas-us-east.keyless.technology` |
| EU | `https://authentication-service.eks.core-production.keyless.technology` |
| LATAM | `https://authentication-service.eks.core-production.latam.keyless.technology` |
| Sandbox | `https://authentication-service-sandbox.eks.core-production.keyless.technology` |

Config is read via `configStore.getEffective()` — never `process.env` directly in a handler.

---

## `recognizeService.js` API

File: `demo_api_server/services/recognizeService.js`

All methods throw if `RECOGNIZE_API_KEY` or `RECOGNIZE_TENANT_NAME` are unset — they never silently no-op.

### `initiateSession(userId) → { sessionToken, sessionId }`

Starts a face-auth session for the given PingOne user ID. Returns `sessionToken` (passed to the WebSDK) and `sessionId` (stored in the challenge for later verification).

```
POST {baseUrl}/v1/customers/{tenantName}/sessions
X-API-Key: {apiKey}
{ "username": "{userId}" }
→ { sessionToken: "...", sessionId: "..." }
```

### `verifySession(sessionId, sdkResult) → boolean`

Verifies the SDK result against the session. Returns `true` if `status === 'ACCEPTED'`, `false` otherwise.

```
POST {baseUrl}/v1/customers/{tenantName}/sessions/{sessionId}/verify
X-API-Key: {apiKey}
{sdkResult}
→ { status: "ACCEPTED" | "REJECTED" }
```

### `enrollUser(userId)`

Triggers live (camera) enrollment registration in the Recognize tenant.

```
POST {baseUrl}/v1/customers/{tenantName}/enrollments
X-API-Key: {apiKey}
{ "username": "{userId}" }
```

### `enrollFromImage(userId, imageBase64, scenario)`

Silent enrollment from a pre-verified selfie (e.g. from PingOne Verify). `scenario` is `TRUSTED_SOURCE` (default), `SELFIE`, or `DOCUMENT`.

```
POST {baseUrl}/v1/customers/{tenantName}/enrollments
X-API-Key: {apiKey}
{ "username": "{userId}", "image": "{base64jpeg}", "scenario": "TRUSTED_SOURCE" }
```

Remove `\n` characters and the `-----BEGIN/END PUBLIC KEY-----` wrapper from any image public key before use (per Recognize API docs).

### `unenrollUser(userId)`

Removes the user's biometric profile from the tenant.

```
DELETE {baseUrl}/v1/customers/{tenantName}/enrollments/{userId}
X-API-Key: {apiKey}
```

---

## HITL Consent Flow (`hitl_consent_mfa_mode=recognize`)

### Full happy path

```
POST /consent-challenge/:id/confirm
  → mfaMode === 'recognize'
  → recognizeService.initiateSession(userId)
  → { ok: true, mode: 'recognize', sessionToken, sessionId }
  → UI mounts RecognizeOverlay with sessionToken
  → SDK WEB_AUTHENTICATION runs
  → onFinish(sdkResult)
  → POST /consent-challenge/:id/verify-recognize { result: sdkResult }
  → recognizeService.verifySession(sessionId, sdkResult) → true
  → ch.status = 'confirmed'
  → POST /api/transactions { consentChallengeId } → executes
```

### Fallback chain — OTP on any failure

Every failure point falls back to `onetime` OTP. The fallback is **transparent** — the user sees "Face ID unavailable — sending a one-time code instead." and the OTP modal appears automatically.

| Failure point | How fallback triggers |
|---|---|
| `initiateSession` throws (API down, bad key) | `confirmChallenge` catches, runs `_initiateOnetimeOtp` inline, returns `{ mode: 'onetime_fallback', ... }` |
| SDK `onError` fires in browser | `RecognizeOverlay` calls `onFallback` after 3000ms auto-dismiss; UI calls `POST /recognize-fallback` |
| `verifySession` returns `false` | `verifyRecognize` returns `{ ok: false, fallback: true }` → UI calls `POST /recognize-fallback` |
| `verifySession` throws | Same as above |

**`/recognize-fallback` route:** resets challenge from `recognize_pending` back to `pending`, then runs the `onetime` OTP path. Returns the same shape as `confirmChallenge` in `onetime` mode.

### Challenge status lifecycle for `recognize` mode

```
pending → [confirmChallenge recognize branch] → recognize_pending
recognize_pending → [verifyRecognize ok] → confirmed
recognize_pending → [verifyRecognize fail / recognizeFallback] → otp_pending (onetime path)
confirmed → [verifyAndConsumeChallenge] → deleted
```

### Key session fields set during recognize flow

```js
ch.recognizePath      = true        // distinguishes from mfaPath / oneTimePath
ch.recognizeSessionId = sessionId   // used by verifyRecognize
ch.status             = 'recognize_pending'
ch.otpExpiresAt       = now + OTP_TTL_MS  // reuses existing TTL constant
```

---

## BFF Routes

All under `/api/transactions/` prefix in `server.js` (same pattern as `verify-otp`):

| Route | Handler | Purpose |
|---|---|---|
| `POST /consent-challenge/:id/verify-recognize` | `txConsent.verifyRecognize(req, challengeId, req.body.result)` | Validate SDK result, advance to confirmed |
| `POST /consent-challenge/:id/recognize-fallback` | `txConsent.recognizeFallback(req, challengeId)` | Pivot from recognize_pending to onetime OTP |

Enrollment lifecycle routes under `/api/recognize/`:

| Route | Handler | Purpose |
|---|---|---|
| `POST /api/recognize/enroll` | `recognizeService.enrollUser` or `enrollFromImage` | Live enrollment or image enrollment |
| `DELETE /api/recognize/enroll` | `recognizeService.unenrollUser` | Remove biometric profile |

`POST /api/recognize/enroll` accepts optional body `{ imageBase64, scenario }` — when present it calls `enrollFromImage`; when absent it calls `enrollUser` (live camera enrollment is initiated client-side by the WebSDK, not server-side).

---

## WebSDK Integration

### CDN URL

```
https://cdn.keyless.technology/web-sdk/latest/pingone-recognize.js
```

Loaded via a `<script>` tag injected by React components (`RecognizeOverlay`, `RecognizeEnrollCard`). The tag is idempotent — both components check for `window.PingOneRecognize` before injecting a second tag.

### Content-Security-Policy

`server.js` helmet CSP must include:

```js
scriptSrc: [..., 'https://cdn.keyless.technology'],
connectSrc: [..., 'https://*.keyless.technology'],
```

### SDK initialisation pattern

```js
const instance = window.PingOneRecognize.init(containerElement, {
  sessionToken,            // from initiateSession — face-auth
  // OR: username: userId  // for enrollment capabilities (no sessionToken needed)
  capability: 'WEB_AUTHENTICATION' | 'WEB_ENROLLMENT',
  finishEventDelay: 500,   // ms before auto-submit on success
  errorEventDelay: 3000,   // ms before auto-submit on error — keep >= 3000 so errors are readable
  onFinish: (result) => { /* submit result to BFF */ },
  onError:  (err)    => { /* trigger fallback */ },
});
// cleanup
instance.destroy?.();
```

### `RecognizeOverlay` component (`demo_api_ui/src/components/RecognizeOverlay.tsx`)

Props:
- `sessionToken: string` — from `confirmChallenge` response
- `onSuccess(sdkResult)` — called by `onFinish`; posts to `/verify-recognize`
- `onFallback()` — called by `onError` after 3000ms; posts to `/recognize-fallback`
- `onCancel()` — user cancels; calls `onClose` on the modal

Renders as a full-page overlay (`position: fixed; inset: 0; z-index: 9999`) with a centred card containing the SDK camera container.

### `RecognizeEnrollCard` component (`demo_api_ui/src/components/RecognizeEnrollCard.tsx`)

Rendered as a third `up-card` section on the Profile page (below MFA Devices). Shows:
- Enrollment status (enrolled ✅ / not enrolled)
- "Enroll Face ID" button → SDK `WEB_ENROLLMENT` capability
- "Remove Face ID" button → `DELETE /api/recognize/enroll`
- File input for enroll-from-image → `POST /api/recognize/enroll` with `imageBase64` + `scenario: 'TRUSTED_SOURCE'`

---

## Feature Flag

Admin UI → Feature Flags → `hitl_consent_mfa_mode` → set to `recognize`.

The flag is read in `transactionConsentChallenge.js:confirmChallenge`. All existing modes (`onetime`, `device_picker`, `homegrown`) are unaffected.

---

## Debugging

**Check env vars are set:**
```bash
./run.sh status   # check-env.js prints RECOGNIZE group as ok / partial
```

**Initiate a session manually:**
```bash
curl -X POST \
  https://authentication-service.eks.core-production.saas-us-east.keyless.technology/v1/customers/YOUR_TENANT/sessions \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"username":"test-user"}' | jq .
```
Expected: `{ "sessionToken": "...", "sessionId": "..." }`

**Common errors:**

| Error | Cause | Fix |
|---|---|---|
| `RECOGNIZE_API_KEY is not configured` | Missing env var | Add `RECOGNIZE_API_KEY=` to `.env` |
| `402` / `403` from Recognize API | Invalid API key | Get a fresh key from dashboard → Access Control |
| SDK script fails to load | CSP `scriptSrc` missing CDN domain | Add `https://cdn.keyless.technology` to `scriptSrc` in `server.js` helmet config |
| `recognize_not_expected` (409) | Challenge not in `recognize_pending` state | UI called verify-recognize on wrong challenge or after expiry |
| `recognize_expired` (410) | OTP_TTL_MS elapsed | User took too long — start transaction again |
| Face scan rejected immediately | User not enrolled | Direct user to Profile → Enroll Face ID |

---

## Regression guard

- `transactionConsentChallenge.js` — the `recognize` branch must come **before** the homegrown OTP block. Do not move it after the `generateOtp()` call.
- `verifyRecognize` sets `ch.status = 'confirmed'` only on `ACCEPTED`. It must **not** set confirmed on `verifySession` returning `false` — that path goes to `fallback: true`.
- `recognizeFallback` resets `ch.status` back to `'pending'` before calling `_initiateOnetimeOtp`. If you skip this reset, `_initiateOnetimeOtp` will see `status !== 'pending'` and return a 409.
- The `ontime_fallback` mode key is checked by name in `TransactionConsentModal.tsx`. Do not rename it.

---

## Public documentation

- [PingOne docs index (llms.txt)](https://docs.pingidentity.com/pingone/llms.txt) — machine-readable index of every PingOne doc page. Append `.md` to any `docs.pingidentity.com/pingone/...` URL to fetch it as raw markdown. Use it for authoritative PingOne platform docs (the Recognize/Keyless SDK itself is documented separately at `cdn.keyless.technology`).
