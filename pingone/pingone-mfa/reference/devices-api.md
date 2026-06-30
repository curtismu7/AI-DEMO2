# MFA Devices API (Platform)

**Source:** https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices.html

> This reference covers the Platform API device lifecycle — enrollment,
> activation, listing, deletion, device order. Runtime challenge calls go to
> the auth-host `/deviceAuthentications` endpoint; see
> [device-authentications-api.md](device-authentications-api.md).

---

## Base URL

```
{apiBase} = https://api.pingone.{region}/v1/environments/{envId}
```

All device operations are under `{apiBase}/users/{userId}/devices`.

---

## Operations index

| Method | Path | Content-Type | Purpose |
|---|---|---|---|
| `POST` | `.../users/{userId}/devices` | `application/json` | Create device (SMS, Email, Voice, TOTP, FIDO2, OATH, WhatsApp, Test) |
| `POST` | `.../users/{userId}/devices` | `application/vnd.pingidentity.devices.reorder+json` | Set device order |
| `POST` | `.../users/{userId}/devices` | `application/vnd.pingidentity.devices.order.remove+json` | Remove device order |
| `POST` | `.../users/{userId}/devices/{deviceId}` | `application/vnd.pingidentity.device.activate+json` | Activate device (OTP) |
| `POST` | `.../users/{userId}/devices/{deviceId}` | `application/vnd.pingidentity.otp.check+json` | Activate OATH token |
| `POST` | `.../users/{userId}/devices/{deviceId}` | FIDO2 attestation JSON | Activate FIDO2 device |
| `POST` | `.../users/{userId}/devices/{deviceId}` | `application/vnd.pingidentity.device.unlock+json` | Unlock locked device |
| `POST` | `.../users/{userId}/devices/{deviceId}` | `application/vnd.pingidentity.device.block+json` | Block device |
| `POST` | `.../users/{userId}/devices/{deviceId}` | `application/vnd.pingidentity.device.unblock+json` | Unblock device |
| `POST` | `.../users/{userId}/devices` + `resendPairingOtp` | `application/json` | Resend pairing OTP |
| `GET` | `.../users/{userId}/devices` | — | Read all devices (ordered list) |
| `GET` | `.../users/{userId}/devices?filter=(status eq "ACTIVE")` | — | Filter active devices |
| `GET` | `.../users/{userId}/devices?expand=order` | — | Include order array in response |
| `GET` | `.../users/{userId}/devices/{deviceId}` | — | Read one device |
| `PUT` | `.../users/{userId}/devices/{deviceId}` | `application/json` `{ "nickname": "..." }` | Update device nickname |
| `PUT` | `.../users/{userId}/devices/{deviceId}` | `application/json` | Send device logs |
| `DELETE` | `.../users/{userId}/devices/{deviceId}` | — | Delete device |

---

## Device types

| `type` | Notes |
|---|---|
| `EMAIL` | Requires `email` field |
| `SMS` | Requires `phone` (E.164) |
| `VOICE` | Requires `phone` (E.164); optional `extension` |
| `TOTP` | Third-party authenticator apps (Google Authenticator, etc.) — returns `secret`/`keyUri` |
| `FIDO2` | Passkeys, platform biometrics, security keys (replaces deprecated `PLATFORM`/`SECURITY_KEY`) |
| `MOBILE` | Native push app — **cannot be created via POST**; must use pairing key |
| `OATH_TOKEN` | Hardware OATH tokens (`tokenType`: `HOTP` or `TOTP`) |
| `WHATSAPP` | WhatsApp OTP delivery |
| `PLATFORM` | Deprecated — use `FIDO2` |
| `SECURITY_KEY` | Deprecated — use `FIDO2` |
| `PINGID_MOBILE` / `PINGID_DESKTOP` / `YUBIKEY` | PingID users only |

> **MOBILE devices cannot be created via `POST .../devices`.** The user must
> pair via a pairing key. See [device-mobile-push.md](device-mobile-push.md).

---

## Common device properties

| Property | Type | Description |
|---|---|---|
| `id` | String (RO) | Device unique identifier |
| `type` | String (Required) | Device type — see table above |
| `status` | String | `ACTIVE` or `ACTIVATION_REQUIRED` |
| `user.id` | String | ID of the owner user |
| `environment.id` | String (RO) | Environment ID |
| `nickname` | String (Optional/Mutable) | Display name in UI; max 100 chars; empty string clears it |
| `policy.id` | String (Optional) | Device auth policy to apply; **not returned in GET; not usable in PUT** |
| `notification.policy.id` | String (Optional/Mutable) | Notification policy ID |
| `tokenType` | String (RO) | OATH tokens only: `HOTP` or `TOTP` |
| `lock.status` | String (RO) | `LOCKED` or `UNLOCKED` (too many failed OTP attempts) |
| `lock.expiresAt` | Date (RO) | When lock expires |
| `lock.reason` | String (RO) | `OTP` or `PUSH` |
| `block.status` | String (RO) | `BLOCKED` or `UNBLOCKED` (admin block) |
| `block.blockedAt` | Date (RO) | When block was applied |
| `createdAt` / `updatedAt` | Date (RO/Immutable) | Timestamps |

### `status` rules

- **Worker token request (on behalf of user):** can set `ACTIVE` (pre-paired,
  no OTP required) or `ACTIVATION_REQUIRED` (user must activate).
- **User's own token:** status can only be `ACTIVATION_REQUIRED`.
- Devices stuck in `ACTIVATION_REQUIRED` for **24 hours are auto-deleted**.
- Max **50 devices per user** in `ACTIVATION_REQUIRED` status — exceeding returns
  `LIMIT_EXCEEDED`.

---

## EMAIL-specific properties

| Property | Type | Notes |
|---|---|---|
| `email` | String (Required/Immutable) | Must be a valid email address |
| `testMode` | Boolean (Optional/Mutable) | OTP returned in `test.otp` instead of sent |
| `test.otp` | Integer (RO) | Present in response when `testMode: true` and `ACTIVATION_REQUIRED` |
| `notification` | Object (Optional/Immutable) | Custom pairing notification; **not returned in GET; not usable in PUT** |
| `notification.template.locale` | String | ISO language code (e.g. `en`) |
| `notification.template.variant` | String | Content variant name |
| `notification.template.variables` | Map[String,String] | Dynamic template variables |

---

## SMS/VOICE-specific properties

| Property | Type | Notes |
|---|---|---|
| `phone` | String (Required/Immutable) | E.164 format: `+<country><number>` e.g. `+11235557890` |
| `extension` | String (Optional/Immutable) | VOICE only; can include digits, commas, `#`, `*` |
| `notification` | Object (Optional/Immutable) | Custom pairing notification (same shape as EMAIL) |
| `testMode` | Boolean (Optional/Mutable) | Same as EMAIL |
| `test.otp` | Integer (RO) | Same as EMAIL |

---

## Create device

```http
POST {apiBase}/users/{userId}/devices
Authorization: Bearer {workerToken}
Content-Type: application/json

{
  "type": "SMS",
  "phone": "+15551234567",
  "status": "ACTIVE"
}
```

Worker-created with `ACTIVE` → device is immediately usable.
User's own token → `status` forced to `ACTIVATION_REQUIRED`.

---

## Activate device (OTP)

```http
POST {apiBase}/users/{userId}/devices/{deviceId}
Authorization: Bearer {workerToken}
Content-Type: application/vnd.pingidentity.device.activate+json

{
  "otp": "123456"
}
```

Transitions device from `ACTIVATION_REQUIRED` → `ACTIVE`.

---

## Device order

The **first active device** in the ordered list is the **default device** and
is used automatically at authentication time without prompting the user to
choose.

### Set order

```http
POST {apiBase}/users/{userId}/devices
Authorization: Bearer {workerToken}
Content-Type: application/vnd.pingidentity.devices.reorder+json

{
  "devices": [
    { "id": "{deviceId1}" },
    { "id": "{deviceId2}" }
  ]
}
```

### Remove order

```http
POST {apiBase}/users/{userId}/devices
Authorization: Bearer {workerToken}
Content-Type: application/vnd.pingidentity.devices.order.remove+json
```

After removal, user has no default device and must pick at each authentication.

### List with order

```
GET {apiBase}/users/{userId}/devices?expand=order
```

Response includes an `order` array of activated device IDs in priority order.
`ACTIVATION_REQUIRED` devices are listed after active devices, in no particular
order.

### Default device exceptions

The default device is **not** automatically used when:
1. Authenticating from a native app with device authorization enabled (native
   device used for seamless auth instead).
2. User has a FIDO2 platform device and a session token cookie exists on the
   browser (FIDO2 takes precedence even if not default).

---

## Device lock / block

### Unlock (worker only)

```http
POST {apiBase}/users/{userId}/devices/{deviceId}
Authorization: Bearer {workerToken}
Content-Type: application/vnd.pingidentity.device.unlock+json
```

Clears a `lock.status: LOCKED` caused by too many failed OTP or push attempts.

### Block / Unblock (admin action)

```http
POST {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.block+json
# or
Content-Type: application/vnd.pingidentity.device.unblock+json
```

Blocked devices show `block.status: BLOCKED`.

---

## Custom pairing notification

When creating an EMAIL/SMS/VOICE device with `status: ACTIVATION_REQUIRED`,
include a `notification` object to customize the OTP delivery message:

```json
{
  "type": "EMAIL",
  "email": "user@example.com",
  "status": "ACTIVATION_REQUIRED",
  "notification": {
    "template": {
      "locale": "en",
      "variant": "variant_B",
      "variables": {
        "sum": "1,000,000",
        "currency": "USD",
        "recipient": "Charlie Parker"
      }
    }
  }
}
```

Template name used by PingOne is `device_pairing`. `deliveryMethod` is inferred
from device type. `notification` is **not returned by GET** and **cannot be
used in PUT**.

---

## NO_USABLE_DEVICES in flows

When the `/deviceAuthentications` challenge returns `FAILED` with
`NO_USABLE_DEVICES`, the response includes an `unavailableDevices` array of IDs
so the UI can surface which specific devices are locked/at-limit:

```json
{
  "status": "FAILED",
  "error": {
    "code": "NO_USABLE_DEVICES",
    "message": "Couldn't find authenticating device for user: {userId}",
    "unavailableDevices": [
      { "id": "edccc773-6f31-4d28-a8e1-0f427d9a9df8" }
    ]
  }
}
```

---

## Update nickname

```http
PUT {apiBase}/users/{userId}/devices/{deviceId}
Authorization: Bearer {workerToken}
Content-Type: application/json

{
  "nickname": "My Work Phone"
}
```

Empty string `""` clears the nickname.

---

## Delete device

```http
DELETE {apiBase}/users/{userId}/devices/{deviceId}
Authorization: Bearer {workerToken}
```

If the deleted device was the **default (first)** device, the second active
device on the order list automatically becomes the new default.
