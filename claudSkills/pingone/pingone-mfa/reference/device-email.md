# Device: Email

**Banking status:** ✅ **Wired** in `demo_api_server/services/mfaService.js`
(`enrollEmailDevice`). Route: `POST /api/auth/mfa/enroll/email`. Activation is
completed through the unified OTP path at challenge time
(`deviceAuthentications` → `/otp`), same as SMS.

---

## Shape

- `type: "EMAIL"`
- Contact field: `email` (a valid address; usually the user's directory email)
- Activation: 6-digit OTP delivered by email; user submits the code

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

Email, SMS, and WhatsApp share **one unified OTP flow** — the only difference
is the `type` field and the contact field (`email` vs `phone`).

---

## Enroll

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <workerToken>

{ "type": "EMAIL", "email": "user@example.com" }
```

`enrollEmailDevice(userId, email)` uses the **worker token**. Success (201)
returns `{ id, type, email, status, _links }`. A worker-created email device
may come back `ACTIVE`; with a user token PingOne returns
`ACTIVATION_REQUIRED` and sends an OTP.

---

## Activate

Same activation contract as the generic spine (PingOne documents this as
**`POST`**; banking's `completeSmsEnrollment` uses `PUT` for the same endpoint —
both work, see device-sms.md note):

```
POST {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.activate+json
Authorization: Bearer <workerToken>

{ "otp": "123456" }
```

Or, at challenge time via the unified OTP path:

```
POST {authBase}/deviceAuthentications              → DEVICE_SELECTION_REQUIRED
POST {authBase}/deviceAuthentications/{daId}        (select EMAIL device)
   Content-Type: application/vnd.pingidentity.device.select+json
   → OTP_REQUIRED  (PingOne emails the code)
POST {authBase}/deviceAuthentications/{daId}/otp
   Content-Type: application/vnd.pingidentity.otp.check+json
   { "otp": "123456" }                              → COMPLETED | FAILED
```

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`).
`selectDevice` → worker token; `submitOtp` → user access token.

---

## Email-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | `INVALID_DATA` | Missing/invalid `email` |
| 400 | "Invalid OTP" | Wrong/expired code (OTP lifetime set by device-auth policy, default 10 min) |
| 400 | `INVALID_VALUE` | Email not allowed by the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 404 | `NOT_FOUND` | Wrong `deviceId`/`userId` |
| 409 | `UNIQUENESS_VIOLATION` | Email device already exists for this user |

Mask OTP codes in logs (`mfaService` does this).

---

## See also

- [device-sms.md](device-sms.md) — same unified OTP flow, `phone` instead of `email`
- [device-whatsapp.md](device-whatsapp.md) — third member of the unified OTP family (reference only)
- [policy-and-scopes.md](policy-and-scopes.md) — enabling Email in the device-auth policy
- SKILL.md §3 — generic lifecycle spine and status transitions
