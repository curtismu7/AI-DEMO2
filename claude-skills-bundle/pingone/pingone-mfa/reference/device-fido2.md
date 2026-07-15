# Device: FIDO2 / Passkey (WebAuthn)

**Banking status:** ✅ **Wired** in `demo_api_server/services/mfaService.js`
(`initFido2Registration`, `completeFido2Registration`, plus
`submitFido2Assertion` for challenge-time). Routes:
`POST /api/auth/mfa/enroll/fido2-init`, `POST /api/auth/mfa/enroll/fido2-complete`.
UI helpers: `demo_api_ui/src/utils/passkeyCeremony.js`
(`normalizePublicKeyRequestOptions`, `formatPublicKeyCredentialAssertion`,
`b64ToBytes` / `bytesToB64`).

**Official docs:**
- Product hub: https://docs.pingidentity.com/pingone/strong_authentication_mfa/p1_strong_authentication_start.md
- MFA API intro: https://developer.pingidentity.com/pingone-api/mfa/introduction.md
- Check Assertion (FIDO): https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/check-assertion-device-authentication.html
- MFA Device Authentications: https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications.html

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
2. Decode `challenge`, `user.id`, `excludeCredentials[].id` with **base64url-aware**
   conversion (`b64ToBytes` in `passkeyCeremony.js`). PingOne often sends
   base64url (`-`/`_`, no padding). Plain `atob()` throws
   `Failed to execute 'atob'…`. Jackson may also emit signed byte arrays —
   `b64ToBytes` accepts those too.
3. Coerce `pubKeyCredParams[].alg` to integer when PingOne returns strings.
4. Call `navigator.credentials.create({ publicKey: opts })`.
5. Serialize credential binary fields with **standard base64** (`bytesToB64` /
   PingOne sample `toBase64Str`):
   `{ id, type, rawId, response.clientDataJSON, response.attestationObject }`.

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
  Clients (`MFATestPage`, enroll helpers) must send `window.location.origin`.

PingOne validates challenge, origin, RP ID, attestation; on success status →
`ACTIVE`.

---

## Challenge-time assertion

Assert after `ASSERTION_REQUIRED` (see MFA Device Authentications + Check
Assertion docs). PingOne returns `publicKeyCredentialRequestOptions` as a
**string** (or pre-parsed object via the BFF).

```
POST {authBase}/deviceAuthentications/{daId}
Content-Type: application/vnd.pingidentity.assertion.check+json
Authorization: Bearer <userAccessToken>

{
  "origin": "<browser window.location.origin>",
  "assertion": "<JSON string from navigator.credentials.get()>",
  "compatibility": "FULL"
}
```

Request model (required): **`origin`** (string), **`assertion`** (string).
Optional: **`compatibility`** — `FULL` | `SECURITY_KEY_ONLY` | `NONE`
(banking hardcodes `FULL` when a platform authenticator is available).

`{authBase} = https://auth.pingone.{region}/{envId}` (no `/as`).

### Browser ceremony (do this, not the sample's naive `Uint8Array(string)`)

PingOne's published JS sample does
`publicKeyCredential.challenge = new Uint8Array(options.challenge)`. That only
works when `challenge` / `allowCredentials[].id` are **numeric arrays**. Live
PingOne payloads are usually **base64url strings** — use
`normalizePublicKeyRequestOptions()` from `passkeyCeremony.js` instead:

1. `JSON.parse` if the options value is a string.
2. Decode `challenge` + `allowCredentials[].id` via `b64ToBytes` (base64url +
   byte-array tolerant).
3. Pass only WebAuthn fields: `challenge`, `rpId`, `timeout`,
   `userVerification`, `allowCredentials` (+ `transports`), `extensions`.
4. `navigator.credentials.get({ publicKey })`.
5. Format with `formatPublicKeyCredentialAssertion(credential)` (standard
   base64 on binary fields) and POST to the BFF with **`origin:
   window.location.origin`**. The BFF `submitFido2Assertion` JSON.stringifies
   the assertion object into the required String property and rejects a missing
   origin.

Timeout: `submitFido2Assertion` uses 45s (hardware/biometric UX).
Status: `ASSERTION_REQUIRED → COMPLETED | FAILED`.

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
| 400 | attestation/origin invalid | `origin` mismatch vs signed `clientDataJSON`; `attestation`/`assertion` sent as object not string; missing origin |
| 400 | `INVALID_VALUE` | FIDO2 not enabled in the device-auth policy |
| 403 | insufficient scope | Worker app missing `p1:create:device` / `p1:update:device` |
| 429 | `REQUEST_LIMITED` / `LIMIT_EXCEEDED` | FIDO2 device cap — delete existing device and retry (handled automatically) |
| (browser) | `InvalidCharacterError` / `atob` | Decoded with plain `atob` — use base64url (`b64ToBytes`) |
| (browser) | `NotAllowedError` | User cancelled or no authenticator — surface a retry, never break other login forms |

---

## See also

- [device-totp.md](device-totp.md) — the other "prove possession" device (OTP code instead of attestation)
- [policy-and-scopes.md](policy-and-scopes.md) — enabling FIDO2 and resident-key settings in the device-auth policy
- [device-authentications-api.md](device-authentications-api.md) — challenge status machine + token rules
- [oauth-pingone skill](../../oauth-pingone/SKILL.md) — username-less passkey *login* (the auth-side half)
- SKILL.md §3 — content-types and challenge status transitions
- SKILL.md **See Also → Official PingOne docs**
