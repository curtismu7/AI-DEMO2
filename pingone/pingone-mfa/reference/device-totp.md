# Device: TOTP (Authenticator App)

**Banking status:** ⚠️ **Reference only — NOT wired** in
`demo_api_server/services/mfaService.js`. There is no `enrollTotpDevice` /
TOTP activation helper and no `/enroll/totp*` route. PingOne *does* report TOTP
devices at challenge time (`initiateDeviceAuth` logs `TOTP → time-based OTP`),
so a TOTP device enrolled out-of-band participates in step-up. To add TOTP
enrollment, follow the pattern of `enrollEmailDevice` + an activate helper
(PingOne documents activate as **`POST`** `.../devices/{deviceId}` with
`device.activate+json`; banking's existing SMS helper uses `PUT` for the same
endpoint — either works). Verify against `mfaService.js` before wiring.

---

## Shape

- `type: "TOTP"`, created with `status: "ACTIVATION_REQUIRED"` (the user must
  prove they configured an authenticator app — there is no PingOne-sent OTP).
- The create **response** carries `secret` and `keyUri` (an `otpauth://totp/...`
  URI you render as a QR code). Render `keyUri` exactly as received.
- There is **no resend OTP** for TOTP — the code comes from the user's app.

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

---

## Preconditions

1. User exists (`userId`).
2. User MFA-enabled: `PUT {apiBase}/users/{userId}/mfaEnabled` `{ "mfaEnabled": true }`.
3. Device-auth policy has TOTP enabled (`totp.enabled = true`).

---

## Create (provision secret + QR)

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <workerToken>

{
  "type": "TOTP",
  "status": "ACTIVATION_REQUIRED",
  "nickname": "Authenticator App",
  "policy": { "id": "{deviceAuthPolicyId}", "type": "DEVICE_AUTHENTICATION_POLICY" }
}
```

Response (relevant parts):

```jsonc
{
  "id": "{deviceId}",
  "type": "TOTP",
  "status": "ACTIVATION_REQUIRED",
  "secret": "BASE32SECRET...",
  "keyUri": "otpauth://totp/example:user@example.com?secret=BASE32SECRET...",
  "_links": { "device.activate": { "href": ".../devices/{deviceId}" } }
}
```

Capture `deviceId`, `secret`, `keyUri`, and the `device.activate` link
(hypermedia-first: prefer that href when present, else the templated device URL).

Show the user the QR (from `keyUri`) **and** the raw `secret` as copyable text.
Never send `secret` / `keyUri` back to PingOne — they are for the user's app
only. In this educational demo the secret may be shown in the UI; keep it out
of logs.

---

## Activate (6-digit code from the app)

```
POST {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.activate+json
Authorization: Bearer <workerToken>

{ "otp": "123456" }
```

On success status → `ACTIVE`. There is no "resend"; on a wrong code, the user
reads the next rotating code from their app and retries.

---

## Challenge-time

A TOTP code is verified the same way as any OTP at challenge time:

```
POST {authBase}/deviceAuthentications              → DEVICE_SELECTION_REQUIRED
POST {authBase}/deviceAuthentications/{daId}        (select TOTP device)
POST {authBase}/deviceAuthentications/{daId}/otp
   Content-Type: application/vnd.pingidentity.otp.check+json
   { "otp": "123456" }                              → COMPLETED | FAILED
```

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`).

---

## TOTP-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | "Invalid OTP" | Code from app is wrong or out of the time window (clock skew) |
| 400 | `INVALID_VALUE` | TOTP not enabled in the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 409 | `UNIQUENESS_VIOLATION` | TOTP device already exists for this user |

---

## See also

- [device-fido2.md](device-fido2.md) — the other "prove possession" device (attestation, not OTP); wired
- [policy-and-scopes.md](policy-and-scopes.md) — `totp.enabled` in the device-auth policy
- SKILL.md §4 — banking grounding (what is and isn't wired)
