# Device: Mobile (Push / SDK-paired)

**Banking status:** ⚠️ **Reference only — NOT wired** in
`demo_api_server/services/mfaService.js`. There is no mobile pairing or push
helper and no `/enroll/mobile*` route. The challenge layer *does* handle
`PUSH_CONFIRMATION_REQUIRED` (`selectDevice` logs the push-wait branch and
`getDeviceAuthStatus` polls), so a mobile device paired out-of-band can satisfy
a step-up. Verify against `mfaService.js` before wiring enrollment.

---

## Shape

A "Mobile" device is a phone running an app built with the PingOne MFA SDK.
Two flavors:
- **Push-capable** — PingOne sends a push notification; the app approves/denies.
- **OTP fallback** — when push can't be delivered, the app or PingOne falls
  back to an OTP (the playground models Mobile as an OTP device using the
  `SMSFlowController`, so the OTP half is SMS-shaped).

Enrollment is **pairing**: PingOne issues a pairing key (often a QR /
`p1:create:pairingKey` scope); the SDK app scans/consumes it to bind the device.

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

---

## Create (pairing)

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <workerToken>

{ "type": "MOBILE", "policy": { "id": "{deviceAuthPolicyId}" } }
```

Response includes a pairing artifact (e.g. a pairing key / QR payload). The
SDK app consumes it; the device transitions to `ACTIVE` once the app completes
pairing. Pairing flows may require `p1:create:pairingKey` /
`p1:read:pairingKey` on the worker app in addition to `p1:create:device`.

---

## Challenge-time: push vs OTP fallback

```
POST {authBase}/deviceAuthentications              → DEVICE_SELECTION_REQUIRED
POST {authBase}/deviceAuthentications/{daId}        (select MOBILE device)
   → PUSH_CONFIRMATION_REQUIRED            (push sent to the app)
GET  {authBase}/deviceAuthentications/{daId}        (poll)
   → COMPLETED | PUSH_CONFIRMATION_TIMED_OUT
```

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`).
`getDeviceAuthStatus` (worker token) is the poll call. On push timeout, the
flow can fall back to OTP (`OTP_REQUIRED` → `/otp`) if the policy allows it.

---

## Device order / priority

When a user has multiple devices, the device-auth policy / device list
ordering determines the default. To make push the preferred factor, order the
mobile device ahead of others (PingOne device order / policy mobile settings;
exact payload in [policy-and-scopes.md](policy-and-scopes.md)). Banking does
not expose device-order UI; documented for completeness.

---

## Mobile-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | `INVALID_VALUE` | Mobile/push not enabled in the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` (and `p1:create:pairingKey` for pairing) |
| 408 / status | `PUSH_CONFIRMATION_TIMED_OUT` | User didn't approve the push in time — restart challenge or fall back to OTP |
| 429 | `REQUEST_LIMITED` | Device cap — delete an old device, retry |

---

## See also

- [device-fido2.md](device-fido2.md) — the other "no PingOne-sent OTP" device
- [policy-and-scopes.md](policy-and-scopes.md) — pairing-key scopes, push settings, device order
- SKILL.md §3 — `PUSH_CONFIRMATION_REQUIRED` in the challenge status transitions
