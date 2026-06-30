# Device: SMS

**Banking status:** ✅ **Wired** in `demo_api_server/services/mfaService.js`
(`enrollSmsDevice`, `completeSmsEnrollment`). Routes:
`POST /api/auth/mfa/enroll/sms-init`, `POST /api/auth/mfa/enroll/sms-complete`.
`MOBILE_PHONE` devices are treated as SMS at challenge time.

> ⚠️ `routes/mfaStepUp.js` was removed — it was dead code (never mounted), and
> its `/sms` + `/sms/verify` logic duplicated the live `routes/mfa.js`. SMS
> step-up goes through the challenge-time path below.

---

## Shape

- `type: "SMS"`
- Contact field: `phone` in **E.164** (`+<country><number>`, e.g.
  `+15551234567`). Reject non-E.164 before calling PingOne — it returns 400.
- Activation: OTP delivered by SMS; user submits the 6-digit code.

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

---

## Enroll

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <token>

{ "type": "SMS", "phone": "+15551234567" }
```

Token behavior (observed in `enrollSmsDevice`):

| Token used | Resulting status | Why |
|---|---|---|
| User access token | `ACTIVATION_REQUIRED` | PingOne sends OTP; user must confirm possession |
| Worker token only | `ACTIVE` | Admin-created, trusted; no OTP step |

`enrollSmsDevice` prefers the user token and **falls back to the worker token**
on 401/403/"insufficient"/"scope" responses (single retry, no token = worker).

Success (201) returns `{ id, type, phone, status, _links }` where
`_links.activate.href` is the canonical activation URL (prefer it when present).

---

## Activate (complete enrollment)

```
PUT {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.activate+json
Authorization: Bearer <workerToken>

{ "otp": "123456" }
```

> ⚠️ Verb divergence (real, in banking code). `completeSmsEnrollment` uses
> **`PUT`** (shown above — this doc mirrors the actual implementation). But
> PingOne's own docs and banking's `completeFido2Registration` use **`POST`**
> for the *identical* `device.activate+json` endpoint. Both are accepted by
> PingOne; match the verb the existing helper uses rather than "fixing" one to
> the other.

`completeSmsEnrollment(userId, deviceId, otp)` uses the **worker token** here.
On success status → `ACTIVE`.

---

## Resend OTP

There is no dedicated "resend" device endpoint for enrollment. To get a fresh
code, re-trigger the OTP send (challenge-time uses
`POST {authBase}/deviceAuthentications` → select device → PingOne re-sends).
SMS/Email/WhatsApp share one unified OTP path — only the `type` differs.

---

## Challenge-time (step-up) path

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`):

```
POST {authBase}/deviceAuthentications            → DEVICE_SELECTION_REQUIRED
POST {authBase}/deviceAuthentications/{daId}     (select SMS device)
   Content-Type: application/vnd.pingidentity.device.select+json
   → OTP_REQUIRED  (PingOne texts the code)
POST {authBase}/deviceAuthentications/{daId}/otp
   Content-Type: application/vnd.pingidentity.otp.check+json
   { "otp": "123456" }                            → COMPLETED | FAILED
```

`mfaService.selectDevice` uses the **worker** token; `submitOtp` uses the
**user** access token.

---

## SMS-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | `INVALID_DATA` | `phone` not E.164, or missing |
| 400 | "Invalid OTP" | Wrong/expired code (10-min lifetime by policy) |
| 400 | `INVALID_VALUE` | SMS not allowed by the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 404 | `NOT_FOUND` | Wrong `deviceId` after enroll, or wrong `userId` |
| 429 | `REQUEST_LIMITED` | Device cap hit — delete an old device, retry |

Never log full phone numbers or OTP codes (`mfaService` masks both).

---

## See also

- [device-email.md](device-email.md) — same unified OTP flow, `email` instead of `phone`
- [device-whatsapp.md](device-whatsapp.md) — `type: "WHATSAPP"`, same path (reference only)
- [policy-and-scopes.md](policy-and-scopes.md) — enabling SMS in the device-auth policy
- SKILL.md §3 — generic lifecycle spine and status transitions
