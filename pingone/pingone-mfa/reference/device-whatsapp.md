# Device: WhatsApp

**Banking status:** ⚠️ **Reference only — NOT wired** in
`demo_api_server/services/mfaService.js`. No `enrollWhatsappDevice` helper
and no `/enroll/whatsapp*` route. PingOne treats WhatsApp as an SMS-like OTP
factor (`type: "WHATSAPP"`), so it would slot into the **unified OTP path**
exactly like SMS — only the `type` field changes. To wire it, mirror
`enrollSmsDevice` / `completeSmsEnrollment` with `type: "WHATSAPP"`. Verify
against `mfaService.js` before wiring.

---

## Shape

- `type: "WHATSAPP"`
- Contact field: `phone` in **E.164** (same validation as SMS)
- Activation: OTP delivered over WhatsApp by PingOne's configured sender; user
  submits the 6-digit code
- Same hook/controller/service as SMS and Email — only `type` differs
  (unified OTP architecture)

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

---

## Enroll

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <token>

{ "type": "WHATSAPP", "phone": "+15551234567" }
```

Token behavior is the same as SMS:

| Token used | Resulting status |
|---|---|
| User access token | `ACTIVATION_REQUIRED` (PingOne sends WhatsApp OTP) |
| Worker token only | `ACTIVE` (admin-created) |

PingOne sends all outbound WhatsApp messages through its configured sender;
the environment must have WhatsApp messaging provisioned.

---

## Activate

PingOne documents activate as **`POST`** (banking's SMS helper uses `PUT` for
the same endpoint — either works; see device-sms.md note):

```
POST {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.activate+json
Authorization: Bearer <workerToken>

{ "otp": "123456" }
```

Or via the unified challenge-time OTP path (select device → `/otp` with
`application/vnd.pingidentity.otp.check+json`), identical to SMS/Email. Status
→ `ACTIVE` / `COMPLETED`.

---

## Two-route registration (UI shape, reference)

The playground splits WhatsApp registration into a config route and a device
route (like TOTP/FIDO2), and additionally distinguishes an **Admin flow**
(worker token, optional admin-set device status) from a **User flow** (user
OAuth access token). Banking does not implement this UI; documented here so an
agent wiring WhatsApp knows the two-token distinction maps onto the same
SMS-style API calls.

---

## WhatsApp-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | `INVALID_DATA` | `phone` not E.164 |
| 400 | "Invalid OTP" | Wrong/expired code |
| 400 | `INVALID_VALUE` | WhatsApp not enabled in the device-auth policy, or env has no WhatsApp sender |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 409 | `UNIQUENESS_VIOLATION` | WhatsApp device already exists for this user |

---

## See also

- [device-sms.md](device-sms.md) — the wired sibling; identical API, `type: "SMS"`
- [device-email.md](device-email.md) — third member of the unified OTP family
- [policy-and-scopes.md](policy-and-scopes.md) — enabling WhatsApp in the device-auth policy
- SKILL.md §4 — wired vs reference-only device table
