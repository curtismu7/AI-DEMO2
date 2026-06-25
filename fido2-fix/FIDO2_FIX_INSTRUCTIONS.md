# FIDO2 Registration Fix — Dev Instructions

## Problem

`completeFido2Registration` in `mfaService.js` was calling the wrong HTTP method
and using the wrong content-type, causing PingOne to reject the device activation.

| What was wrong | What it should be |
|---|---|
| `PUT .../users/{userId}/devices/{deviceId}` | `POST .../users/{userId}/devices/{deviceId}` |
| `Content-Type: application/json` | `Content-Type: application/vnd.pingidentity.device.activate+json` |
| Body: `{ attestation: { ...fields } }` | Body: attestation fields spread at root **+** `origin` field |

## Files Changed

### 1. `banking_api_server/services/mfaService.js`

Replace the `completeFido2Registration` function (around line 266–287).

**Old code:**
```js
async function completeFido2Registration(userId, deviceId, attestation) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    const { data } = await axios.put(
      url,
      { attestation },
      { headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    console.log('[MFA] completed FIDO2 registration userId=%s deviceId=%s status=%s', userId, deviceId, data.status);
    return data;
  } catch (err) {
    throw _wrapError('completeFido2Registration', err);
  }
}
```

**New code** (already applied in the repo — just copy from `mfaService.js` in this zip):
- Uses `axios.post` (not `put`)
- Sets `Content-Type: application/vnd.pingidentity.device.activate+json`
- Spreads attestation fields at body root (not nested under `{ attestation }`)
- Appends `origin` — reads from `PINGONE_FIDO2_ORIGIN` env var, falls back to `https://auth.pingone.{region}`

### 2. `banking_api_server/src/__tests__/mfaService.test.js`

The `completeFido2Registration` describe block (around line 365–380) has been updated
to assert the new POST behaviour, activation content-type, flat body, and origin field.
No other tests were changed.

## Environment Variable (Optional)

If the PingOne FIDO2 relying-party origin differs from `https://auth.pingone.com`,
set this in `.env`:

```
PINGONE_FIDO2_ORIGIN=https://your-custom-origin.example.com
```

Otherwise the default (`https://auth.pingone.{region}`) is used.

## Verification

Run the unit test suite:
```bash
cd banking_api_server
npm test -- --testPathPattern=mfaService --no-coverage
```

All tests in `mfaService.test.js` should pass (including the two new `completeFido2Registration` tests).
