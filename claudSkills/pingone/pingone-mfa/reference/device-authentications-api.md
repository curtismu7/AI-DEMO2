# MFA Device Authentications API — Implementation Cheatsheet

**Sources:**
- https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications.html
- https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-email.html
- https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-sms.html

---

## The key insight: one-time auth needs no device registration

For the **default MFA path** in this demo, use one-time auth. No device
enrollment, no pairing, no `deviceId`. Just look up the user's email or phone
from the user record and pass it inline. PingOne sends the OTP and you verify
it. Two calls total.

---

## Base URL

```
{authBase} = https://auth.pingone.{region}/{envId}
```

**No `/as` segment.** `mfaService._authBaseUrl()` returns this correctly.

---

## One-time Email OTP — full flow

### Step 1: Initiate (sends OTP to email)

```http
POST {authBase}/{envId}/deviceAuthentications
Authorization: Bearer {userAccessToken}
Content-Type: application/json

{
  "user": { "id": "{userId}" },
  "selectedDevice": {
    "oneTime": {
      "type": "EMAIL",
      "email": "abc@ping.com"
    }
  }
}
```

Response `201 Created`:
```json
{
  "id": "0fa3daf8-499d-4d7a-8829-00d16ee84d5d",
  "status": "OTP_REQUIRED",
  "_embedded": { "devices": [{ "type": "EMAIL", "email": "ab****@ping.com" }] },
  "selectedDevice": { "oneTime": { "type": "EMAIL", "email": "ab****@ping.com" } },
  "user": { "id": "991776fd-145b-499e-8237-2c62aef35b2c" },
  "policy": { "id": "5a0a0950-8a81-4739-b12a-f4d6a11c7a82" },
  "_links": {
    "otp.check": { "href": "https://auth.pingone.eu/{envId}/deviceAuthentications/{daId}" }
  }
}
```

Save `id` as `{daId}`. Status is immediately `OTP_REQUIRED` — no device
selection step needed.

### Step 2: Verify OTP

```http
POST {authBase}/{envId}/deviceAuthentications/{daId}
Authorization: Bearer {workerToken}
Content-Type: application/vnd.pingidentity.otp.check+json

{
  "otp": "123456"
}
```

Response on success: `status: "COMPLETED"`
Response on failure: `status: "FAILED"` with retry info or lockout.

---

## One-time SMS OTP — full flow

### Step 1: Initiate (sends OTP by SMS)

```http
POST {authBase}/{envId}/deviceAuthentications
Authorization: Bearer {userAccessToken}
Content-Type: application/json

{
  "user": { "id": "{userId}" },
  "selectedDevice": {
    "oneTime": {
      "type": "SMS",
      "phone": "+14135550150"
    }
  }
}
```

Response `201 Created`:
```json
{
  "id": "0ff545da-016a-4ae7-a8c6-84d67f7b20ea",
  "status": "OTP_REQUIRED",
  "_embedded": { "devices": [{ "type": "SMS", "phone": "*******44" }] },
  "selectedDevice": { "oneTime": { "type": "SMS", "phone": "*******44" } },
  "user": { "id": "991776fd-145b-499e-8237-2c62aef35b2c" }
}
```

### Step 2: Verify OTP

Same as email — `POST {daId}` with `Content-Type: application/vnd.pingidentity.otp.check+json` and `{ "otp": "123456" }`.

---

## Token rules (critical)

| Operation | Token |
|---|---|
| POST initiate (step 1) | **User access token** |
| POST otp.check (step 2) | **Worker token** |
| GET poll status | **Worker token** |
| POST device.select | **Worker token** |

PingOne returns `401 INVALID_TOKEN` if you use a user token on the `{daId}`
sub-resource calls. `_wrapError` in `mfaService.js` maps this to
`code:'token_expired'` for retry.

---

## Flow status values

| Status | Meaning |
|---|---|
| `OTP_REQUIRED` | OTP sent — await user input, then POST otp.check |
| `DEVICE_SELECTION_REQUIRED` | Multiple devices; user must pick one |
| `ASSERTION_REQUIRED` | FIDO2 flow — await WebAuthn assertion |
| `PUSH_CONFIRMATION_REQUIRED` | Push sent to mobile — poll GET |
| `PUSH_CONFIRMATION_TIMED_OUT` | Push expired — restart |
| `COMPLETED` | Auth succeeded |
| `FAILED` | Check `error.code` |

For one-time auth, you'll only ever see `OTP_REQUIRED` → `COMPLETED`/`FAILED`.

---

## Key request fields

| Field | Required? | Notes |
|---|---|---|
| `user.id` | **Required** | PingOne user UUID — look up by username/email first |
| `selectedDevice.oneTime.type` | Optional | `EMAIL`, `SMS`, or `VOICE` |
| `selectedDevice.oneTime.email` | Conditional | Required when type is `EMAIL` |
| `selectedDevice.oneTime.phone` | Conditional | Required when type is `SMS`/`VOICE`; must be E.164 (`+14135550150`) |
| `selectedDevice.oneTime.testMode` | Optional | `true` → OTP returned in `test.otp` body instead of delivered (API/DaVinci only) |
| `policy.id` | Optional | Device auth policy; defaults to environment policy |

For enrolled-device flows (not one-time), use `selectedDevice.id` instead.

---

## Error codes

| HTTP | Code | Fix |
|---|---|---|
| 400 | `INVALID_DATA` / "Invalid OTP" | Wrong/expired OTP |
| 400 | `INVALID_VALUE` | Device type not in policy, or bad phone format |
| 401 | `INVALID_TOKEN` | Wrong token type (user vs worker) or expired |
| 403 | insufficient scope | Worker app missing scope |
| 410 | gone | Transaction expired — start a new one |
| `FAILED` status | `NO_USABLE_DEVICES` | User's devices locked/at-limit; `unavailableDevices[]` has IDs |

---

## Test mode (automated testing)

```json
{
  "user": { "id": "{userId}" },
  "selectedDevice": {
    "oneTime": { "type": "SMS", "phone": "+15551234567", "testMode": true }
  }
}
```

Response includes `"test": { "otp": "827341" }`. OTP is **not** sent to the
phone. Only works via direct API or DaVinci — PingOne UI strips `test.otp`.

---

## Poll status (enrolled-device / push flows only)

```http
GET {authBase}/{envId}/deviceAuthentications/{daId}
Authorization: Bearer {workerToken}
```

Not needed for one-time OTP flows — status is synchronous on the verify call.

---

## Cancel / change device

```http
POST {authBase}/{envId}/deviceAuthentications/{daId}
Authorization: Bearer {workerToken}
Content-Type: application/json

{ "reason": "CHANGE_DEVICE" }
```

---

## Where to get user email/phone for one-time auth

Look up the user by `username` or `email` via the Management API before
initiating:

```
GET {apiBase}/users?filter=username eq "{username}"
Authorization: Bearer {workerToken}
```

The user object contains `email` and `mobilePhone` (E.164). Pass these
directly into the `oneTime` object — no device registration needed.

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`
