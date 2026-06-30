# One-Time OTP Flow — Implementation Guide

> **The default MFA path for this demo.** No device registration, no pairing,
> no deviceId. Look up the user's email or phone from PingOne, send an OTP,
> poll waiting for the user to enter it. Two service calls.

---

## Why one-time OTP

The existing `initiateDeviceAuth` requires the user to have enrolled MFA
devices and a policy. One-time auth skips all that — PingOne sends the OTP
directly to a phone or email you supply inline. Ideal for step-up MFA on users
who may not have devices enrolled.

---

## Full flow (two calls)

```
BFF                              PingOne auth
 |                                    |
 |-- POST /deviceAuthentications ---->|  (user token, email/phone inline)
 |<-- 201 { id: daId, status: OTP_REQUIRED } --|
 |                                    |
 |  [user receives OTP, enters it in UI]
 |                                    |
 |-- POST /deviceAuthentications/{daId} -->|  (worker token, otp.check)
 |<-- { status: COMPLETED } -----------|
```

No device selection step. No polling. Status goes straight to `OTP_REQUIRED`
on initiate, then `COMPLETED` or `FAILED` on verify.

---

## Step 1: Initiate (send OTP)

**Token:** User access token from session (`req.session.oauthTokens.accessToken`)
**Base URL:** `_authBaseUrl()` → `https://auth.pingone.{region}/{envId}`

```javascript
const authBase = mfaService._authBaseUrl();

const resp = await axios.post(
  `${authBase}/deviceAuthentications`,
  {
    user: { id: userId },
    selectedDevice: {
      oneTime: {
        type: 'EMAIL',          // or 'SMS'
        email: userEmail,       // from PingOne user record
        // phone: userPhone,    // E.164 e.g. '+14135550150' for SMS
      }
    }
  },
  {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  }
);

const { id: daId, status } = resp.data;
// status === 'OTP_REQUIRED' — save daId in session for step 2
```

Response shape:
```json
{
  "id": "0fa3daf8-...",
  "status": "OTP_REQUIRED",
  "_embedded": { "devices": [{ "type": "EMAIL", "email": "ab****@ping.com" }] },
  "user": { "id": "..." }
}
```

---

## Step 2: Verify OTP (user submits the code)

**Token:** Worker token from `_getWorkerToken()` — NOT the user token
**Content-Type:** `application/vnd.pingidentity.otp.check+json`

```javascript
const workerToken = await mfaService._getWorkerToken();
const authBase = mfaService._authBaseUrl();

const resp = await axios.post(
  `${authBase}/deviceAuthentications/${daId}`,
  { otp: userEnteredOtp },
  {
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/vnd.pingidentity.otp.check+json',
    },
    timeout: 10000,
  }
);

const { status } = resp.data;
// status === 'COMPLETED' → MFA passed
// status === 'FAILED'    → wrong OTP or max retries
```

---

## Getting user email / phone before step 1

Look up the user by their PingOne `userId` (already on session post-login) or
by username:

```javascript
const apiBase = mfaService._apiBaseUrl();
const workerToken = await mfaService._getWorkerToken();

// If you have userId from session:
const resp = await axios.get(
  `${apiBase}/users/${userId}`,
  { headers: { Authorization: `Bearer ${workerToken}` }, timeout: 8000 }
);
const { email, mobilePhone } = resp.data;
// mobilePhone is E.164 e.g. "+14135550150"
```

Prefer email as the delivery method — less friction in demos. Fall back to
`mobilePhone` / SMS if email not set. Never hardcode; always read from user
record.

---

## Session storage pattern

Store `daId` in the session between step 1 and step 2 — same pattern used by
the existing HITL challenge flow:

```javascript
// After step 1:
req.session.mfaChallenge = { daId, method: 'EMAIL', initiatedAt: Date.now() };

// In step 2 handler:
const { daId } = req.session.mfaChallenge || {};
if (!daId) return res.status(400).json({ error: 'No active MFA challenge' });
// ... verify, then clear:
delete req.session.mfaChallenge;
```

---

## Polling — when you need it

For one-time OTP flows you do **not** need to poll. The user enters the OTP in
the UI, the BFF gets a POST, and you verify immediately. Only push/mobile flows
need polling.

If you ever do need to check the state of a transaction (e.g., timeout
detection):

```javascript
const workerToken = await mfaService._getWorkerToken();
const resp = await axios.get(
  `${authBase}/deviceAuthentications/${daId}`,
  { headers: { Authorization: `Bearer ${workerToken}` }, timeout: 8000 }
);
const { status } = resp.data;
```

---

## Error handling — follow mfaService._wrapError pattern

```javascript
try {
  // step 1 or step 2
} catch (err) {
  const status = err.response?.status;
  const pingErr = err.response?.data;
  const e = new Error(pingErr?.message || 'MFA operation failed');
  e.status = status || 500;
  e.pingError = pingErr;
  if (status === 401) e.code = 'token_expired';
  if (status === 404 || status === 410) e.code = 'challenge_expired';
  throw e;
}
```

Key codes to handle in the route:
- `token_expired` → call `_tryRefresh(req)` and retry once
- `challenge_expired` → tell user to restart MFA (410 means transaction gone)
- `FAILED` status → wrong OTP; response may include remaining attempt count

---

## Adding to mfaService.js

New methods follow the same shape as existing ones — `_debug` block, `_wrapError`, configStore for creds:

```javascript
// Initiate one-time OTP (user token)
async initiateOneTimeOtp(userId, deliveryType, contact, userAccessToken) {
  const authBase = this._authBaseUrl();
  const oneTime = deliveryType === 'EMAIL'
    ? { type: 'EMAIL', email: contact }
    : { type: 'SMS', phone: contact };

  const _debug = { request: { url: `${authBase}/deviceAuthentications`, body: { user: { id: userId }, selectedDevice: { oneTime } } } };
  try {
    const resp = await axios.post(
      `${authBase}/deviceAuthentications`,
      { user: { id: userId }, selectedDevice: { oneTime } },
      { headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    _debug.response = { status: resp.status, data: resp.data };
    return { ...resp.data, _debug };
  } catch (err) {
    err._debug = _debug;
    throw this._wrapError('initiateOneTimeOtp', err);
  }
},

// Verify OTP (worker token)
async verifyOneTimeOtp(daId, otp) {
  const authBase = this._authBaseUrl();
  const workerToken = await this._getWorkerToken();
  const _debug = { request: { url: `${authBase}/deviceAuthentications/${daId}`, body: { otp: '[REDACTED]' } } };
  try {
    const resp = await axios.post(
      `${authBase}/deviceAuthentications/${daId}`,
      { otp },
      { headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/vnd.pingidentity.otp.check+json' }, timeout: 10000 }
    );
    _debug.response = { status: resp.status, data: resp.data };
    return { ...resp.data, _debug };
  } catch (err) {
    err._debug = _debug;
    throw this._wrapError('verifyOneTimeOtp', err);
  }
},
```

---

## Route shape

```javascript
// POST /api/auth/mfa/onetime/initiate
router.post('/onetime/initiate', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const userAccessToken = req.session.oauthTokens?.accessToken;

  // Look up user's email/phone from PingOne
  const { email, mobilePhone } = await getUserContact(userId);
  const [deliveryType, contact] = email
    ? ['EMAIL', email]
    : ['SMS', mobilePhone];

  const result = await mfaService.initiateOneTimeOtp(userId, deliveryType, contact, userAccessToken);
  req.session.mfaChallenge = { daId: result.id, method: deliveryType, initiatedAt: Date.now() };
  res.json({ daId: result.id, method: deliveryType, maskedContact: result._embedded?.devices?.[0]?.[deliveryType.toLowerCase()] });
});

// POST /api/auth/mfa/onetime/verify
router.post('/onetime/verify', requireAuth, async (req, res) => {
  const { otp } = req.body;
  const { daId } = req.session.mfaChallenge || {};
  if (!daId) return res.status(400).json({ error: 'no_challenge' });

  const result = await mfaService.verifyOneTimeOtp(daId, otp);
  if (result.status === 'COMPLETED') {
    delete req.session.mfaChallenge;
    req.session.mfaVerified = true;
    return res.json({ status: 'COMPLETED' });
  }
  res.status(401).json({ status: result.status, error: result.error });
});
```

---

## What NOT to do

- Do not use `initiateDeviceAuth` for one-time flows — it requires enrolled devices
- Do not store OTPs server-side — PingOne validates them; never echo them
- Do not use the user token for the verify call — it will 401
- Do not mix `_getWorkerToken()` calls between methods that run fast — cache isn't needed, but avoid calling it twice in one request
- Never log `otp` values — the `_debug` block above redacts them
