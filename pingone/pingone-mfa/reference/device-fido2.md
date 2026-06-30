# Device: FIDO2 / Passkey (WebAuthn)

**Banking status:** ✅ **Wired** in `demo_api_server/services/mfaService.js`
(`initFido2Registration`, `completeFido2Registration`, plus
`submitFido2Assertion` for challenge-time). Routes:
`POST /api/auth/mfa/enroll/fido2-init`, `POST /api/auth/mfa/enroll/fido2-complete`.

---

## Shape

- `type: "FIDO2"`. Enrollment is a WebAuthn **registration ceremony**:
  PingOne issues `publicKeyCredentialCreationOptions`; the browser runs
  `navigator.credentials.create()`; the resulting attestation is sent back.
- No OTP. Possession is proven by the authenticator (security key / platform
  biometric).

`{apiBase} = https://api.pingone.{region}/v1/environments/{envId}`.

---

## Init (create device + get creation options)

```
POST {apiBase}/users/{userId}/devices
Content-Type: application/json
Authorization: Bearer <workerToken>

{ "type": "FIDO2", "nickname": "My Passkey" }
```

Response carries `id` (deviceId) and `publicKeyCredentialCreationOptions`, a
standard WebAuthn `PublicKeyCredentialCreationOptions`. PingOne may return it as
a **JSON string or an already-parsed object**; `initFido2Registration` accepts
both (`typeof rawCreationOpts === 'string' ? JSON.parse(...) : rawCreationOpts`)
and returns the raw value through as
`{ deviceId, publicKeyCredentialCreationOptions, _debug }`.

Frontend must:
1. Parse only if it's a string (`typeof opts === 'string' ? JSON.parse(opts) : opts`).
2. Convert byte arrays to `Uint8Array`: `challenge`, `user.id`,
   `excludeCredentials[].id`.
3. Call `navigator.credentials.create({ publicKey: opts })`.
4. Serialize the credential to base64url:
   `{ id, type, rawId, response.clientDataJSON, response.attestationObject,
   clientExtensionResults }`.

`initFido2Registration` has device-cap recovery: on
`REQUEST_LIMITED` / `LIMIT_EXCEEDED` it deletes the user's existing FIDO2
device and retries once.

---

## Complete (activate with attestation)

```
POST {apiBase}/users/{userId}/devices/{deviceId}
Content-Type: application/vnd.pingidentity.device.activate+json
Authorization: Bearer <workerToken>

{ "attestation": "<JSON string of the WebAuthn attestation object>", "origin": "https://api.ping.demo:4000" }
```

Critical details (enforced in `completeFido2Registration`):
- `attestation` must be a **JSON string**, not an object.
- `origin` **must match** the browser origin where the ceremony ran (the value
  inside the signed `clientDataJSON`). Banking resolves it from
  `requestOrigin` → `configStore.getEffective('pingone_fido2_origin')` →
  `REACT_APP_CLIENT_URL` → `https://api.ping.demo:4000`. An origin mismatch is
  the most common FIDO2 failure (logged as `[FIDO2-DIAG] ORIGIN MISMATCH`).

PingOne validates challenge, origin, RP ID, attestation; on success status →
`ACTIVE`.

---

## Challenge-time assertion

```
POST {authBase}/deviceAuthentications/{daId}
Content-Type: application/vnd.pingidentity.assertion.check+json
Authorization: Bearer <userAccessToken>

{ "origin": "<browser origin>", "assertion": "<JSON string from navigator.credentials.get()>", "compatibility": "FULL" }
```

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`).
`submitFido2Assertion` sends `assertion` as a JSON string and uses a longer
timeout (45s) since the user interacts with hardware. Status transitions
`ASSERTION_REQUIRED → COMPLETED | FAILED`.

---

## Usernameless / passkey (discoverable credentials)

For username-less login, the creation options must allow resident /
discoverable credentials (`authenticatorSelection.residentKey`). The flow is
**auth-first, register-fallback**: attempt `navigator.credentials.get()` with
PingOne-issued request options; if the browser reports no credentials, fall
back to the registration ceremony above. The discoverable-credential login
itself is an auth-side concern — see `oauth-pingone`. This skill only owns the
**device registration** half.

---

## FIDO2-specific errors

| HTTP | Signal | Cause / fix |
|---|---|---|
| 400 | attestation/origin invalid | `origin` mismatch vs signed `clientDataJSON`; `attestation` sent as object not string |
| 400 | `INVALID_VALUE` | FIDO2 not enabled in the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 429 | `REQUEST_LIMITED` / `LIMIT_EXCEEDED` | FIDO2 device cap — delete existing device and retry (handled automatically) |
| (browser) | `NotAllowedError` | User cancelled or no authenticator — surface a retry, never break other login forms |

---

## See also

- [device-totp.md](device-totp.md) — the other "prove possession" device (OTP code instead of attestation)
- [policy-and-scopes.md](policy-and-scopes.md) — enabling FIDO2 and resident-key settings in the device-auth policy
- [oauth-pingone skill](../../oauth-pingone/SKILL.md) — username-less passkey *login* (the auth-side half)
- SKILL.md §3 — content-types and challenge status transitions
