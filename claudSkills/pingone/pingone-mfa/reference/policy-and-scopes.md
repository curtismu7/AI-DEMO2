# Policy & Scopes

**Banking status:** ⚠️ **Partially wired.** `mfaService.js` reads policies
(`_getDefaultMfaPolicy` via `GET {apiBase}/mfaPolicies`, cached) but does
**not** create or update device-auth policies. Policy CRUD here is PingOne
reference for wiring new code; the scope matrix *is* what the banking worker
app needs. Verify against `mfaService.js` before assuming a create/update path
exists.

---

## 1. Full worker-token scope matrix

Worker (client_credentials) token on the **PingOne API** resource. Least
privilege — do not expand without a documented reason.

| Scope | Required for | Notes |
|---|---|---|
| `p1:read:user` | Lookup user by username/email; read MFA state | Required |
| `p1:update:user` | Set `mfaEnabled` on the user | Required for enroll preconditions |
| `p1:read:device` | List / read a user's devices | Required |
| `p1:create:device` | Create SMS/Email/TOTP/FIDO2/Mobile devices | Required |
| `p1:update:device` | Activate device, change nickname/status | Required |
| `p1:delete:device` | Delete a device | Required |
| `p1:create:pairingKey` | QR / mobile-SDK pairing flows | Optional (mobile push) |
| `p1:read:pairingKey` | Read pairing-key metadata | Optional |
| `p1:update:userMfaEnabled` | Explicit MFA-enabled toggle from the worker | Optional |

Keep the scope string in one place. A `403` from any `/devices` or
`/deviceAuthentications` call is almost always a missing `p1:*:device` scope on
the worker app, not a code bug. Never log the worker `access_token`.

Banking minting path: `mfaService._getWorkerToken()` →
`pingone_worker_token_client_id` / `_secret` (fallback: management creds),
posted to `getTokenEndpoint()` with `grant_type=client_credentials`. Read all
of these via `configStore.getEffective(key)` — never `process.env` in a route
handler (CLAUDE.md non-negotiable).

---

## 2. Device-authentication-policies API

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

| Operation | Request |
|---|---|
| List all | `GET {apiBase}/deviceAuthenticationPolicies` → `_embedded.deviceAuthenticationPolicies[]` |
| Resolve default | filter list for `default === true`, else first entry |
| By name | list, then filter on `name` (no native by-name endpoint) |
| Create | `POST {apiBase}/deviceAuthenticationPolicies` (full policy body) |

> Banking legacy: `mfaService.js` reads `GET {apiBase}/mfaPolicies` (alias) and
> caches the default in `_cachedDefaultPolicyId`; `_resetDefaultPolicyCache()`
> clears it (used by unit tests). New code should prefer
> `deviceAuthenticationPolicies`.

### Create-from-template

1. Read the template (e.g. the default) policy.
2. Strip system fields: `id`, `createdAt`, `updatedAt`, `_links`.
3. Set a new unique `name` (409 `UNIQUENESS_VIOLATION` if it exists).
4. Optionally merge custom settings.
5. `POST {apiBase}/deviceAuthenticationPolicies`.

```jsonc
// cloned template body (system fields removed), illustrative
{
  "name": "BankingMfaPolicy",
  "default": false,
  "sms":   { "enabled": true,  "otp": { "lifetime": { "duration": 10, "timeUnit": "MINUTES" }, "otpLength": 6 } },
  "email": { "enabled": true },
  "totp":  { "enabled": true },
  "fido2": { "enabled": true },
  "mobile":{ "enabled": false },
  "pairingDisabled": false,
  "promptForNicknameOnPairing": true,
  "skipUserLockVerification": false
}
```

Per-factor enablement (`sms.enabled`, `email.enabled`, `totp.enabled`,
`fido2.enabled`, `mobile.enabled`) is what gates each device type — a 400
`INVALID_VALUE` on create/activate usually means the factor is disabled in the
policy bound to that user.

---

## 3. Policy vs environment settings (don't conflate)

| Level | API | Examples |
|---|---|---|
| **Environment** (applies to all policies) | MFA Settings API | pairing max devices / key format / timeout; lockout failure count + duration; global OTP length/validity |
| **Policy** (per device-auth policy) | Device Authentication Policies API | `pairingDisabled`, `promptForNicknameOnPairing`, `skipUserLockVerification`, per-factor `enabled`, FIDO2 / resident-key settings, device order |

Only map policy-level fields when cloning a policy. Lockout/OTP-length style
settings are environment-level and must not be forced into the policy body.

---

## 4. Pairing / one-time-device flags

| Flag | Effect |
|---|---|
| `pairingDisabled` | When true, blocks new device pairing under this policy |
| `promptForNicknameOnPairing` | UI nicknames on pair (banking always stores a nickname; `updateDeviceNickname` patches it) |
| `skipUserLockVerification` | Skip the user-lock check during device auth |

One-time / transient devices (e.g. a phone number used once for OTP without a
persisted device) are governed by the policy's OTP settings; the lifecycle is
the same create → activate → (auto-expire) but the device is not retained.

---

## 5. Common policy/scope errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | `INVALID_VALUE` | Device type disabled in the bound device-auth policy |
| 403 | insufficient scope | Worker app missing a `p1:*:device` / `p1:*:user` scope |
| 404 | `NOT_FOUND` | Policy id wrong, or no default policy in the environment |
| 409 | `UNIQUENESS_VIOLATION` | New policy `name` already exists |

---

## See also

- SKILL.md §1–§2 — scope matrix + policy API in the lean index
- [device-sms.md](device-sms.md), [device-email.md](device-email.md), [device-totp.md](device-totp.md), [device-fido2.md](device-fido2.md), [device-whatsapp.md](device-whatsapp.md), [device-mobile-push.md](device-mobile-push.md) — per-factor enablement
- [oauth-pingone skill](../../oauth-pingone/SKILL.md) — RFC 8693 device-auth token exchange mechanics
