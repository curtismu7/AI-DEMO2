# HITL PingOne MFA Integration Design

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Augment the HITL consent challenge flow to use real PingOne MFA (all enrolled devices) for transactions ≥ $500, with a feature flag toggle. Homegrown OTP path unchanged when flag is off.

---

## Problem Statement

The current HITL consent challenge at $500+ uses a homegrown email OTP (HMAC-SHA256 hash, session-bound, 6-digit code). For demo purposes this doesn't showcase PingOne's MFA capabilities. The goal is to replace the $500+ OTP step with a real PingOne `deviceAuthentications` challenge — showing all enrolled devices (OTP, FIDO2, SMS, etc.) — while preserving the existing path as a toggle-off fallback.

---

## Decisions

| Question | Decision |
|---|---|
| Replace or augment? | Augment — PingOne MFA path added alongside homegrown, feature-flag controlled |
| Which devices? | All enrolled devices via `deviceAuthentications` — device picker required |
| Where in flow? | $500+ threshold only — same gate as today's step-up path |
| Consent checkbox? | Unchanged — MFA fires after consent, as an additional verification step |
| Toggle off behavior | Homegrown email OTP at $500+ unchanged (today's behavior) |

---

## Feature Flag

**Key:** `ff_hitl_pingone_mfa_enabled`
**Default:** `false`
**Set via:** `/config` UI or `.env` (`FF_HITL_PINGONE_MFA_ENABLED=true`)
**Read via:** `getEffective('ff_hitl_pingone_mfa_enabled')` — same pattern as `ff_hitl_enabled`

**Activation conditions (both must be true):**
1. `ff_hitl_pingone_mfa_enabled === true`
2. `amount >= confirm_stepup_threshold_usd` (default $500)

Below $500, the consent checkbox + homegrown OTP path is unchanged regardless of the flag.

---

## Architecture: Option A — Parallel branch inside `transactionConsentChallenge.js`

All HITL logic stays in one service. The flag-gated branch is inserted at `confirmChallenge()` and a new `verifyMfa()` function is added alongside the existing `verifyOtp()`. `verifyAndConsumeChallenge()` is untouched.

---

## Backend Flow (`transactionConsentChallenge.js`)

### Step 1 — `createChallenge()` — no change
Snapshot stored, challengeId returned. No awareness of MFA path yet.

### Step 2 — `confirmChallenge()` — branching point

**Flag off / amount < $500 (existing):**
- Generates homegrown OTP via `crypto.randomBytes`
- Emails it, stores `otpHash` + `otpSalt` in session
- Returns `{ otpSent: true, otpExpiresAt }`

**Flag on + amount ≥ $500 (new):**
- Calls `mfaService.initiateDeviceAuth(userId, userAccessToken)`
- Stores `daId` and `devices` in the challenge session object under `mfaPath: true`
- Returns `{ mfaRequired: true, devices: [...] }`

**Session shape additions (PingOne MFA path only):**
```js
{
  // all existing fields unchanged ...
  mfaPath: true,
  daId: "...",       // PingOne deviceAuthentications ID
  devices: [...],    // device list from initiateDeviceAuth for UI rendering
}
```

### Step 3 — `verifyOtp()` unchanged + new `verifyMfa()`

**`verifyOtp(req, challengeId, otpCode)`** — unchanged. Demo bypass `123123` preserved.

**New: `verifyMfa(req, challengeId, { deviceId, otp, fido2Assertion })`**
- Reads `daId` from challenge session (errors if `mfaPath` not set)
- OTP devices: calls `mfaService.selectDevice(daId, deviceId, userAccessToken)` then `mfaService.submitOtp(daId, deviceId, otp, userAccessToken)`
- FIDO2: calls `mfaService.submitFido2Assertion(daId, fido2Assertion, userAccessToken, origin)`
- On success: promotes challenge status to `confirmed` (same as `verifyOtp`)
- Demo bypass: OTP `123123` accepted on this path too

### Step 4 — `verifyAndConsumeChallenge()` — no change
Checks `status === 'confirmed'`, snapshot match, one-time use. Path-agnostic.

---

## API Surface Changes

### `POST /api/transactions/consent-challenge/:id/confirm`

**Response — flag on + amount ≥ $500 (new):**
```json
{
  "mfaRequired": true,
  "devices": [
    { "id": "...", "type": "EMAIL", "email": "j***@example.com" },
    { "id": "...", "type": "SMS", "phone": "+1***5678" },
    { "id": "...", "type": "FIDO2_KEY", "name": "iPhone Passkey" }
  ]
}
```

**Response — flag off / amount < $500 (unchanged):**
```json
{ "otpSent": true, "otpExpiresAt": "..." }
```

### `POST /api/transactions/consent-challenge/:id/verify-otp`

Same URL, route handler detects path via `challenge.mfaPath` in session.

**PingOne MFA — OTP device:**
```json
{ "deviceId": "...", "otp": "123456" }
```

**PingOne MFA — FIDO2:**
```json
{ "deviceId": "...", "fido2Assertion": { ... } }
```

**Homegrown OTP (unchanged):**
```json
{ "otpCode": "123456" }
```

### `POST /api/transactions/consent-challenge/:id/select-device` (new)

Called after the user picks an OTP device. Triggers PingOne to send the OTP to that device.

```json
{ "deviceId": "..." }
```

Response: `{ "otpSent": true }` or FIDO2 nonce if applicable.

### `GET /api/transactions/consent-challenge/:id` (new if not already present)

Returns current challenge state including `mfaRequired` and `devices`. Allows frontend to re-render device picker after page refresh without re-calling confirm.

---

## Frontend (HITL Modal)

### Flag off — no change
Modal: transaction details → consent checkbox → OTP input → submit.

### Flag on + amount ≥ $500

OTP input replaced with two sequential sub-steps after consent checkbox:

**Sub-step A — Device Picker:**
- Renders `devices` array from confirm response
- Each device: selectable card with icon (email/SMS/passkey) + masked identifier
- OTP device selected → frontend calls a new `POST /api/transactions/consent-challenge/:id/select-device` with `{ deviceId }` → BFF calls `mfaService.selectDevice()` which triggers PingOne to send the OTP to that device → frontend advances to sub-step B
- FIDO2 selected → `navigator.credentials.get()` fires immediately → assertion submitted via `verify-otp` → verified (no sub-step B)

**Sub-step B — OTP Entry (OTP devices only):**
- Same 6-digit input as today
- Submit calls `verify-otp` with `{ deviceId, otp }`

**Modal state machine:**
```
idle
→ consent_checked
→ confirming
→ device_pick          (new)
→ otp_entry            (new, OTP path only)
  | fido2_pending      (new, FIDO2 path only)
→ verified
→ submitting
```

---

## Regression Safety

### Must not break
- All existing `transactionConsentChallenge` tests — flag defaults `false`, homegrown path exercised unchanged
- `123123` demo bypass OTP on both paths
- Transfer-always-requires-HITL rule (REGRESSION_PLAN §1 row 42) — branching is on amount, not type
- `verifyAndConsumeChallenge()` — untouched, snapshot match tests remain valid

### New tests

**Regression test file** (add to existing `transactionConsentChallenge` test file):
1. Flag on + amount ≥ $500 → `confirmChallenge()` returns `mfaRequired: true`, `daId` stored in session, `mfaService.initiateDeviceAuth` called once
2. `verifyMfa()` with OTP → `mfaService.submitOtp()` called, challenge promoted to `confirmed`
3. `verifyMfa()` with FIDO2 → `mfaService.submitFido2Assertion()` called, challenge promoted to `confirmed`
4. Flag on but amount < $500 → homegrown OTP path taken (not PingOne MFA)

**Integration test** (new file: `hitlPingOneMfa.integration.test.js`):
- Flag on end-to-end: create → confirm (gets devices) → verify (OTP) → consume
- Mocks `mfaService` but uses real configStore with `FF_HITL_PINGONE_MFA_ENABLED=true`

### REGRESSION_PLAN.md additions
- **§1:** `transactionConsentChallenge.js` — note `mfaPath` branch, flag name, `verifyAndConsumeChallenge` must remain path-agnostic
- **§4:** Bug fix log entry on implementation

---

## Files Touched

| File | Change |
|---|---|
| `demo_api_server/services/transactionConsentChallenge.js` | Branch in `confirmChallenge()`, new `verifyMfa()` |
| `demo_api_server/routes/transactions.js` | Route handler detects `mfaPath`, calls `verifyMfa()` or `verifyOtp()` accordingly; add `select-device` and GET challenge routes |
| `demo_api_ui/src/components/HITLModal.js` (or equivalent) | New `device_pick`, `otp_entry`, `fido2_pending` states |
| `demo_api_server/src/__tests__/transactionConsentChallenge.regression.test.js` | 4 new test cases |
| `demo_api_server/src/__tests__/hitlPingOneMfa.integration.test.js` | New integration test |
| `REGRESSION_PLAN.md` | §1 and §4 additions |

---

## Out of Scope

- TOTP, WhatsApp, mobile push — reference-only devices remain reference-only
- Changes to the $250 consent-only path (sub-threshold)
- Changes to the MCP HITL agent challenge path (`GET /api/mcp/decision/:taskId`)
- Any PingOne app or policy configuration changes (assumed already set up for MFA)
