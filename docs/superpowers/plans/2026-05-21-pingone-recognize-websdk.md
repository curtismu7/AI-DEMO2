# PingOne Recognize WebSDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PingOne Recognize WebSDK face authentication as a fourth `hitl_consent_mfa_mode` value (`recognize`), with automatic fallback to one-time OTP on any failure, and enrollment/unenroll management on the Profile page.

**Architecture:** A new `recognizeService.js` wraps the Recognize REST API. `transactionConsentChallenge.js` gains a `recognize` branch in `confirmChallenge` that calls `recognizeService.initiateSession`; failure falls back inline to the existing `onetime` OTP path. A new `RecognizeOverlay` full-page React component renders the Recognize WebSDK; on SDK error or verify rejection it calls a new `/recognize-fallback` BFF route which pivots the challenge to one-time OTP. Profile page gains a `RecognizeEnrollCard` component for enrollment lifecycle.

**Tech Stack:** Node.js CommonJS (BFF), TypeScript/React (UI), PingOne Recognize WebSDK (CDN `<script>` tag), Recognize REST API (HTTPS).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `demo_api_server/services/recognizeService.js` | **Create** | Wraps Recognize API: `initiateSession`, `verifySession`, `enrollUser`, `unenrollUser`. Reads config from `configStore`. |
| `demo_api_server/routes/recognize.js` | **Create** | `POST /api/recognize/enroll`, `DELETE /api/recognize/enroll`. |
| `demo_api_server/services/transactionConsentChallenge.js` | **Modify** | Add `recognize` dispatch branch in `confirmChallenge`; add `verifyRecognize`; add `recognizeFallback`. |
| `demo_api_server/server.js` | **Modify** | Register `recognize.js` router; add `verify-recognize` and `recognize-fallback` consent-challenge routes. |
| `demo_api_server/routes/featureFlags.js` | **Modify** | Add `'recognize'` to `hitl_consent_mfa_mode` options + description. |
| `demo_api_ui/src/components/RecognizeOverlay.tsx` | **Create** | Full-page overlay that loads WebSDK, runs face-auth, calls `onSuccess`/`onFallback` callbacks. |
| `demo_api_ui/src/components/RecognizeOverlay.css` | **Create** | Styles for full-page overlay. |
| `demo_api_ui/src/components/RecognizeEnrollCard.tsx` | **Create** | Profile page section: enroll/unenroll/status. |
| `demo_api_ui/src/components/Profile.js` | **Modify** | Add `RecognizeEnrollCard` after MFA Devices section. |
| `demo_api_ui/src/components/TransactionConsentModal.tsx` | **Modify** | Handle `mode: 'recognize'` from `/confirm` → mount `RecognizeOverlay`; handle fallback → pivot to OTP step. |
| `demo_api_server/src/__tests__/recognizeConsent.regression.test.js` | **Create** | Unit tests for `recognize` branch in `confirmChallenge`, `verifyRecognize`, `recognizeFallback`. |

---

## Task 1: Create `recognizeService.js`

**Files:**
- Create: `demo_api_server/services/recognizeService.js`

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/recognizeService.test.js`:

```js
'use strict';
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'RECOGNIZE_API_KEY') return 'test-api-key';
    if (key === 'RECOGNIZE_TENANT_NAME') return 'test-tenant';
    if (key === 'RECOGNIZE_BASE_URL') return 'https://auth.example.com';
    return null;
  }),
}));
jest.mock('axios');
const axios = require('axios');
const recognizeService = require('../services/recognizeService');

describe('recognizeService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('initiateSession calls Recognize API and returns sessionToken', async () => {
    axios.post.mockResolvedValue({ data: { sessionToken: 'tok-abc', sessionId: 'sid-1' } });
    const result = await recognizeService.initiateSession('user-123');
    expect(result.sessionToken).toBe('tok-abc');
    expect(result.sessionId).toBe('sid-1');
    expect(axios.post).toHaveBeenCalledWith(
      'https://auth.example.com/v1/customers/test-tenant/sessions',
      expect.objectContaining({ username: 'user-123' }),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'test-api-key' }) }),
    );
  });

  test('verifySession returns true on accepted result', async () => {
    axios.post.mockResolvedValue({ data: { status: 'ACCEPTED' } });
    const ok = await recognizeService.verifySession('sid-1', { sessionId: 'sid-1' });
    expect(ok).toBe(true);
  });

  test('verifySession returns false on rejected result', async () => {
    axios.post.mockResolvedValue({ data: { status: 'REJECTED' } });
    const ok = await recognizeService.verifySession('sid-1', { sessionId: 'sid-1' });
    expect(ok).toBe(false);
  });

  test('enrollUser calls enrollment endpoint', async () => {
    axios.post.mockResolvedValue({ data: { status: 'ENROLLED' } });
    await expect(recognizeService.enrollUser('user-123')).resolves.not.toThrow();
  });

  test('unenrollUser calls unenroll endpoint', async () => {
    axios.delete.mockResolvedValue({ data: {} });
    await expect(recognizeService.unenrollUser('user-123')).resolves.not.toThrow();
  });

  test('enrollFromImage calls enrollment endpoint with image payload', async () => {
    axios.post.mockResolvedValue({ data: { status: 'ENROLLED' } });
    await expect(recognizeService.enrollFromImage('user-123', 'base64data', 'TRUSTED_SOURCE')).resolves.not.toThrow();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/enrollments'),
      expect.objectContaining({ image: 'base64data', scenario: 'TRUSTED_SOURCE' }),
      expect.any(Object),
    );
  });

  test('initiateSession throws when RECOGNIZE_API_KEY missing', async () => {
    const configStore = require('../services/configStore');
    configStore.getEffective.mockImplementation(() => null);
    await expect(recognizeService.initiateSession('user-123')).rejects.toThrow('RECOGNIZE_API_KEY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_server && npx jest recognizeService.test --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module '../services/recognizeService'`

- [ ] **Step 3: Implement `recognizeService.js`**

Create `demo_api_server/services/recognizeService.js`:

```js
'use strict';

const axios = require('axios');
const configStore = require('./configStore');

function getConfig() {
  const apiKey = configStore.getEffective('RECOGNIZE_API_KEY');
  const tenantName = configStore.getEffective('RECOGNIZE_TENANT_NAME');
  const baseUrl = configStore.getEffective('RECOGNIZE_BASE_URL')
    || 'https://authentication-service.eks.core-production.saas-us-east.keyless.technology';
  if (!apiKey) throw new Error('RECOGNIZE_API_KEY is not configured');
  if (!tenantName) throw new Error('RECOGNIZE_TENANT_NAME is not configured');
  return { apiKey, tenantName, baseUrl };
}

function headers(apiKey) {
  return { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
}

async function initiateSession(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/sessions`;
  const { data } = await axios.post(url, { username: userId }, { headers: headers(apiKey) });
  return { sessionToken: data.sessionToken, sessionId: data.sessionId };
}

async function verifySession(sessionId, sdkResult) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/sessions/${sessionId}/verify`;
  const { data } = await axios.post(url, sdkResult || {}, { headers: headers(apiKey) });
  return data.status === 'ACCEPTED';
}

async function enrollUser(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments`;
  await axios.post(url, { username: userId }, { headers: headers(apiKey) });
}

async function enrollFromImage(userId, imageBase64, scenario) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments`;
  await axios.post(url, { username: userId, image: imageBase64, scenario: scenario || 'TRUSTED_SOURCE' }, { headers: headers(apiKey) });
}

async function unenrollUser(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments/${userId}`;
  await axios.delete(url, { headers: headers(apiKey) });
}

module.exports = { initiateSession, verifySession, enrollUser, enrollFromImage, unenrollUser };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_server && npx jest recognizeService.test --no-coverage 2>&1 | tail -20
```
Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/recognizeService.js demo_api_server/src/__tests__/recognizeService.test.js
git commit -m "feat(recognize): add recognizeService wrapping Recognize REST API"
```

---

## Task 2: Add `recognize` branch to `confirmChallenge` + `verifyRecognize` + `recognizeFallback`

**Files:**
- Modify: `demo_api_server/services/transactionConsentChallenge.js`
- Create: `demo_api_server/src/__tests__/recognizeConsent.regression.test.js`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/recognizeConsent.regression.test.js`:

```js
'use strict';
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'hitl_consent_mfa_mode') return 'recognize';
    if (key === 'confirm_threshold_usd') return '250';
    if (key === 'confirm_stepup_threshold_usd') return '500';
    return null;
  }),
}));
jest.mock('../../services/mfaService', () => ({
  getPingOneUserContact: jest.fn().mockResolvedValue({ email: 'user@example.com', mobilePhone: null }),
  initiateOneTimeOtp: jest.fn().mockResolvedValue({
    id: 'otp-da-id',
    _embedded: { devices: [{ email: 'u***@example.com' }] },
  }),
}));
jest.mock('../../services/recognizeService', () => ({
  initiateSession: jest.fn().mockResolvedValue({ sessionToken: 'tok-abc', sessionId: 'sid-1' }),
  verifySession: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../data/store', () => ({
  getUserById: jest.fn().mockReturnValue({ firstName: 'Test', lastName: 'User' }),
}));

const txConsent = require('../../services/transactionConsentChallenge');

function makeReq(sessionOverrides = {}) {
  const session = {
    txConsentChallenges: {},
    oauthTokens: { accessToken: 'user-token' },
    save: jest.fn((cb) => cb(null)),
    ...sessionOverrides,
  };
  return {
    session,
    user: { id: 'user-123', username: 'testuser' },
  };
}

async function setupPendingChallenge(req) {
  const result = txConsent.createChallenge(req, {
    amount: 600, type: 'transfer',
    fromAccountId: 'acc-1', toAccountId: 'acc-2',
  });
  expect(result.ok).toBe(true);
  return result.challengeId;
}

describe('confirmChallenge — recognize mode', () => {
  test('returns mode:recognize with sessionToken and sessionId on success', async () => {
    const req = makeReq();
    const challengeId = await setupPendingChallenge(req);
    const result = await txConsent.confirmChallenge(req, challengeId);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('recognize');
    expect(result.sessionToken).toBe('tok-abc');
    expect(result.sessionId).toBe('sid-1');
  });

  test('falls back to onetime OTP when recognizeService.initiateSession throws', async () => {
    const recognizeService = require('../../services/recognizeService');
    recognizeService.initiateSession.mockRejectedValueOnce(new Error('Recognize unavailable'));
    const req = makeReq();
    const challengeId = await setupPendingChallenge(req);
    const result = await txConsent.confirmChallenge(req, challengeId);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('onetime_fallback');
    expect(result.otpSent).toBe(true);
  });
});

describe('verifyRecognize', () => {
  test('advances challenge to confirmed on successful face auth', async () => {
    const req = makeReq();
    const challengeId = await setupPendingChallenge(req);
    // put challenge into recognize_pending state
    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';

    const result = await txConsent.verifyRecognize(req, challengeId, { sessionId: 'sid-1' });
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[challengeId].status).toBe('confirmed');
  });

  test('returns 401 and falls back when verifySession returns false', async () => {
    const recognizeService = require('../../services/recognizeService');
    recognizeService.verifySession.mockResolvedValueOnce(false);
    const req = makeReq();
    const challengeId = await setupPendingChallenge(req);
    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';

    const result = await txConsent.verifyRecognize(req, challengeId, { sessionId: 'sid-1' });
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.status).toBe(401);
  });
});

describe('recognizeFallback', () => {
  test('pivots a recognize_pending challenge to one-time OTP path', async () => {
    const req = makeReq();
    const challengeId = await setupPendingChallenge(req);
    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';

    const result = await txConsent.recognizeFallback(req, challengeId);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('onetime_fallback');
    expect(result.otpSent).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd demo_api_server && npx jest recognizeConsent.regression --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `txConsent.verifyRecognize is not a function`

- [ ] **Step 3: Add `recognize` dispatch to `confirmChallenge`**

In `demo_api_server/services/transactionConsentChallenge.js`, add to the top-level requires (after `mfaService`):

```js
const recognizeService = require('./recognizeService');
```

Then inside `confirmChallenge`, insert this block **after the `onetime` branch ends** (after line `// ── End PingOne MFA: one-time OTP branch ─────────────────────────────────`) and **before** the homegrown OTP fallback (`const otpPlain = generateOtp()`):

```js
  // ── PingOne Recognize: face auth branch ──────────────────────────────────
  if (mfaMode === 'recognize') {
    try {
      const { sessionToken, sessionId } = await recognizeService.initiateSession(req.user.id);
      ch.recognizePath      = true;
      ch.recognizeSessionId = sessionId;
      ch.status             = 'recognize_pending';
      ch.otpExpiresAt       = now + OTP_TTL_MS;
      console.log(`[ConsentChallenge] Recognize session initiated challenge=${challengeId.slice(0, 8)}… sessionId=${sessionId} user=${req.user.id}`);
      return { ok: true, challengeId, mode: 'recognize', sessionToken, sessionId };
    } catch (err) {
      console.warn(`[ConsentChallenge] Recognize init failed, falling back to onetime OTP: ${err.message}`);
      // Fall through to onetime OTP fallback below
    }

    // Fallback: one-time OTP
    const userAccessToken = req.session?.oauthTokens?.accessToken;
    let contact, deliveryType;
    try {
      const p = await mfaService.getPingOneUserContact(req.user.id);
      if (p.email) { deliveryType = 'EMAIL'; contact = p.email; }
      else if (p.mobilePhone) { deliveryType = 'SMS'; contact = p.mobilePhone; }
    } catch (err) {
      console.warn(`[ConsentChallenge] recognize fallback: getPingOneUserContact failed: ${err.message}`);
      return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Face ID unavailable and could not start backup verification. Try again.' } };
    }
    if (!contact) {
      ch.oneTimePath    = true;
      ch.pendingContact = true;
      return { ok: true, challengeId, mode: 'onetime_fallback', needsContact: true };
    }
    const otpResult = await _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, userAccessToken, req.user.id, now);
    if (!otpResult.ok) return otpResult;
    return { ...otpResult, mode: 'onetime_fallback' };
  }
  // ── End PingOne Recognize branch ─────────────────────────────────────────
```

- [ ] **Step 4: Add `verifyRecognize` function**

In `demo_api_server/services/transactionConsentChallenge.js`, add this function before `verifyAndConsumeChallenge`:

```js
/**
 * verifyRecognize — validates the Recognize SDK result returned by the UI.
 * On success, advances challenge to 'confirmed'.
 * On failure, sets fallback:true so the route can pivot to OTP.
 */
async function verifyRecognize(req, challengeId, sdkResult) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'recognize_pending') {
    return { ok: false, status: 409, json: { error: 'recognize_not_expected', message: 'No face auth is pending for this challenge.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'recognize_expired', message: 'Face auth session expired. Start the transaction again.' } };
  }

  let accepted;
  try {
    accepted = await recognizeService.verifySession(ch.recognizeSessionId, sdkResult);
  } catch (err) {
    console.warn(`[ConsentChallenge] verifyRecognize error: ${err.message}`);
    accepted = false;
  }

  if (!accepted) {
    console.warn(`[ConsentChallenge] Recognize rejected challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
    return { ok: false, status: 401, fallback: true, json: { error: 'recognize_verify_failed', message: 'Face verification failed.' } };
  }

  const confirmExpiresAt = Date.now() + CONFIRMED_TTL_MS;
  ch.status          = 'confirmed';
  ch.confirmedAt     = Date.now();
  ch.confirmExpiresAt = confirmExpiresAt;
  console.log(`[ConsentChallenge] Recognize verified challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  return { ok: true };
}
```

- [ ] **Step 5: Add `recognizeFallback` function**

In `demo_api_server/services/transactionConsentChallenge.js`, add after `verifyRecognize`:

```js
/**
 * recognizeFallback — called when the UI signals the Recognize SDK failed.
 * Pivots a recognize_pending challenge to the one-time OTP path.
 */
async function recognizeFallback(req, challengeId) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'recognize_pending') {
    return { ok: false, status: 409, json: { error: 'recognize_not_pending', message: 'Challenge is not in recognize state.' } };
  }

  // Reset to pending so the onetime path can re-use it
  ch.status        = 'pending';
  ch.recognizePath = false;

  const userAccessToken = req.session?.oauthTokens?.accessToken;
  let contact, deliveryType;
  try {
    const p = await mfaService.getPingOneUserContact(req.user.id);
    if (p.email) { deliveryType = 'EMAIL'; contact = p.email; }
    else if (p.mobilePhone) { deliveryType = 'SMS'; contact = p.mobilePhone; }
  } catch (err) {
    console.warn(`[ConsentChallenge] recognizeFallback contact lookup failed: ${err.message}`);
    return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Face ID unavailable and could not start backup verification. Try again.' } };
  }

  if (!contact) {
    ch.oneTimePath    = true;
    ch.pendingContact = true;
    return { ok: true, challengeId, mode: 'onetime_fallback', needsContact: true };
  }

  const otpResult = await _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, userAccessToken, req.user.id, Date.now());
  if (!otpResult.ok) return otpResult;
  return { ...otpResult, mode: 'onetime_fallback' };
}
```

- [ ] **Step 6: Export new functions**

In `demo_api_server/services/transactionConsentChallenge.js`, add `verifyRecognize` and `recognizeFallback` to `module.exports`:

```js
module.exports = {
  get HIGH_VALUE_CONSENT_USD() { return getConfirmThreshold(); },
  CHALLENGE_TTL_MS,
  CONFIRMED_TTL_MS,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  normalizeSnapshot,
  validateIntent,
  createChallenge,
  getChallenge,
  confirmChallenge,
  confirmOnetimeContact,
  verifyOtp,
  verifyMfa,
  verifyRecognize,
  recognizeFallback,
  selectMfaDevice,
  getChallengePath,
  verifyAndConsumeChallenge,
};
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest recognizeConsent.regression --no-coverage 2>&1 | tail -20
```
Expected: PASS — 6 tests passing

- [ ] **Step 8: Run existing consent tests to confirm no regressions**

```bash
cd demo_api_server && npx jest transactionConsentChallenge --no-coverage 2>&1 | tail -20
```
Expected: all existing tests still pass

- [ ] **Step 9: Commit**

```bash
git add demo_api_server/services/transactionConsentChallenge.js demo_api_server/src/__tests__/recognizeConsent.regression.test.js
git commit -m "feat(recognize): add recognize branch to confirmChallenge with onetime OTP fallback"
```

---

## Task 3: Add BFF routes for recognize

**Files:**
- Create: `demo_api_server/routes/recognize.js`
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Create `recognize.js` router**

Create `demo_api_server/routes/recognize.js`:

```js
'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const recognizeService = require('../services/recognizeService');

// POST /api/recognize/enroll
// Triggers live enrollment OR enroll-from-image (when imageBase64 + scenario provided).
router.post('/enroll', authenticateToken, express.json(), async (req, res) => {
  try {
    const { imageBase64, scenario } = req.body || {};
    if (imageBase64) {
      await recognizeService.enrollFromImage(req.user.id, imageBase64, scenario || 'TRUSTED_SOURCE');
    } else {
      await recognizeService.enrollUser(req.user.id);
    }
    res.json({ enrolled: true });
  } catch (err) {
    console.error('[Recognize] enroll failed:', err.message);
    res.status(502).json({ error: 'recognize_enroll_failed', message: err.message });
  }
});

// DELETE /api/recognize/enroll
// Removes the Recognize enrollment for the logged-in user.
router.delete('/enroll', authenticateToken, async (req, res) => {
  try {
    await recognizeService.unenrollUser(req.user.id);
    res.json({ enrolled: false });
  } catch (err) {
    console.error('[Recognize] unenroll failed:', err.message);
    res.status(502).json({ error: 'recognize_unenroll_failed', message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register routes in `server.js`**

In `demo_api_server/server.js`, add the require near the other route requires at the top:

```js
const recognizeRoutes = require('./routes/recognize');
```

Then register it **before** the 404 catch-all (find a nearby grouping of `/api/auth` routes and add):

```js
app.use('/api/recognize', recognizeRoutes);
```

Also in `server.js`, locate the block that registers `/consent-challenge/:challengeId/verify-otp` and add two new routes immediately after it:

```js
  '/consent-challenge/:challengeId/verify-recognize',
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { challengeId } = req.params;
    const result = await txConsent.verifyRecognize(req, challengeId, req.body.result || req.body);
    if (!result.ok) {
      return res.status(result.status || 400).json({ ...result.json, fallback: result.fallback || false });
    }
    if (req.session) {
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
    }
    res.json({ ok: true });
  }
);

app.post(
  '/consent-challenge/:challengeId/recognize-fallback',
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { challengeId } = req.params;
    const result = await txConsent.recognizeFallback(req, challengeId);
    if (!result.ok) {
      return res.status(result.status || 400).json(result.json);
    }
    if (req.session) {
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
    }
    res.json(result);
  }
```

> **Note:** The verify-recognize route above needs `app.post(` prepended to it — the first one replaces the last argument of the existing `app.post` call pattern. Match the exact style of the existing `verify-otp` route registration in `server.js` when inserting.

- [ ] **Step 3: Update `server.js` Content-Security-Policy**

In `server.js`, find the `contentSecurityPolicy` `scriptSrc` directive and add the Recognize CDN domain. Also add the Recognize API base URL to `connectSrc`:

```js
scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.keyless.technology'],
// ...
connectSrc: ["'self'", 'https://*.pingone.com', 'https://*.pingidentity.com', 'wss:', 'https://*.keyless.technology'],
```

- [ ] **Step 4: Add `'recognize'` to feature flag options**

In `demo_api_server/routes/featureFlags.js`, find the `hitl_consent_mfa_mode` flag object and update:

```js
description:
  'Controls how the one-time verification code is delivered after the user approves the consent challenge. ' +
  '**onetime** (default) — PingOne sends the OTP directly to the user\'s registered email or phone; no device enrollment required. ' +
  '**device_picker** — full PingOne MFA with device selection (requires enrolled devices + MFA policy). ' +
  '**homegrown** — BFF-generated OTP delivered via the app\'s own email service (no PingOne MFA). ' +
  '**recognize** — PingOne Recognize face authentication (WebSDK); falls back to onetime OTP if Recognize is unavailable or user is not enrolled.',
impact:
  'onetime (default) = PingOne one-time OTP, works for any user with an email or phone on record. ' +
  'device_picker = enrolled-device flow with amount step-up threshold (confirm_stepup_threshold_usd). ' +
  'homegrown = legacy BFF email OTP. ' +
  'recognize = face auth via PingOne Recognize WebSDK; requires RECOGNIZE_API_KEY + RECOGNIZE_TENANT_NAME env vars; falls back to onetime OTP on failure.',
options: ['onetime', 'device_picker', 'homegrown', 'recognize'],
```

- [ ] **Step 5: Smoke-test routes exist**

```bash
cd demo_api_server && node -e "const app = require('./server'); console.log('server loaded ok');" 2>&1 | tail -5
```
Expected: `server loaded ok` (no crash)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/recognize.js demo_api_server/server.js demo_api_server/routes/featureFlags.js
git commit -m "feat(recognize): add recognize BFF routes and feature flag option"
```

---

## Task 4: Create `RecognizeOverlay` React component

**Files:**
- Create: `demo_api_ui/src/components/RecognizeOverlay.tsx`
- Create: `demo_api_ui/src/components/RecognizeOverlay.css`

- [ ] **Step 1: Create `RecognizeOverlay.css`**

Create `demo_api_ui/src/components/RecognizeOverlay.css`:

```css
.recognize-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.recognize-overlay__inner {
  background: #fff;
  border-radius: 0.75rem;
  padding: 2rem;
  width: 420px;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

.recognize-overlay__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  text-align: center;
}

.recognize-overlay__status {
  font-size: 0.875rem;
  color: #6b7280;
  text-align: center;
  min-height: 1.25rem;
}

.recognize-overlay__status--error {
  color: #dc2626;
}

.recognize-overlay__status--fallback {
  color: #d97706;
}

.recognize-overlay__sdk-container {
  width: 375px;
  max-width: 100%;
}

.recognize-overlay__cancel-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  color: #374151;
  cursor: pointer;
}

.recognize-overlay__cancel-btn:hover {
  background: #f9fafb;
}
```

- [ ] **Step 2: Create `RecognizeOverlay.tsx`**

Create `demo_api_ui/src/components/RecognizeOverlay.tsx`:

```tsx
import React, { FC, useEffect, useRef, useState } from 'react';
import './RecognizeOverlay.css';

declare global {
  interface Window {
    PingOneRecognize?: {
      init: (container: HTMLElement, options: RecognizeInitOptions) => RecognizeInstance;
    };
  }
}

interface RecognizeInitOptions {
  sessionToken: string;
  capability: 'WEB_AUTHENTICATION' | 'WEB_ENROLLMENT';
  finishEventDelay?: number;
  errorEventDelay?: number;
  onFinish?: (result: unknown) => void;
  onError?: (err: unknown) => void;
}

interface RecognizeInstance {
  destroy?: () => void;
}

interface RecognizeOverlayProps {
  sessionToken: string;
  onSuccess: (sdkResult: unknown) => void;
  onFallback: () => void;
  onCancel: () => void;
}

const SDK_CDN = 'https://cdn.keyless.technology/web-sdk/latest/pingone-recognize.js';

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PingOneRecognize) { resolve(); return; }
    const existing = document.getElementById('recognize-sdk-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('SDK script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'recognize-sdk-script';
    script.src = SDK_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SDK script failed to load'));
    document.head.appendChild(script);
  });
}

const RecognizeOverlay: FC<RecognizeOverlayProps> = ({
  sessionToken,
  onSuccess,
  onFallback,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<RecognizeInstance | null>(null);
  const [status, setStatus] = useState<string>('Loading face ID…');
  const [isError, setIsError] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let autoFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        await loadSdkScript();
        if (cancelled || !containerRef.current || !window.PingOneRecognize) return;
        setStatus('Look at the camera to verify your identity.');
        instanceRef.current = window.PingOneRecognize.init(containerRef.current, {
          sessionToken,
          capability: 'WEB_AUTHENTICATION',
          finishEventDelay: 500,
          errorEventDelay: 3000,
          onFinish: (result) => {
            if (cancelled) return;
            setStatus('Verifying…');
            onSuccess(result);
          },
          onError: (err) => {
            if (cancelled) return;
            console.warn('[RecognizeOverlay] SDK error:', err);
            setIsError(true);
            setIsFallback(true);
            setStatus('Face ID unavailable — sending a one-time code instead.');
            autoFallbackTimer = setTimeout(() => {
              if (!cancelled) onFallback();
            }, 3000);
          },
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[RecognizeOverlay] Failed to load SDK:', err);
        setIsError(true);
        setIsFallback(true);
        setStatus('Face ID unavailable — sending a one-time code instead.');
        autoFallbackTimer = setTimeout(() => {
          if (!cancelled) onFallback();
        }, 3000);
      }
    })();

    return () => {
      cancelled = true;
      if (autoFallbackTimer) clearTimeout(autoFallbackTimer);
      instanceRef.current?.destroy?.();
    };
  }, [sessionToken, onSuccess, onFallback]);

  return (
    <div className="recognize-overlay" role="dialog" aria-modal="true" aria-label="Face verification">
      <div className="recognize-overlay__inner">
        <h2 className="recognize-overlay__title">Face Verification</h2>
        <p
          className={`recognize-overlay__status${isError ? ' recognize-overlay__status--error' : ''}${isFallback ? ' recognize-overlay__status--fallback' : ''}`}
        >
          {status}
        </p>
        <div ref={containerRef} className="recognize-overlay__sdk-container" />
        {!isFallback && (
          <button type="button" className="recognize-overlay__cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default RecognizeOverlay;
```

- [ ] **Step 3: Verify UI build still compiles**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -15
```
Expected: exit code 0

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/RecognizeOverlay.tsx demo_api_ui/src/components/RecognizeOverlay.css
git commit -m "feat(recognize): add RecognizeOverlay full-page face-auth component"
```

---

## Task 5: Wire `RecognizeOverlay` into `TransactionConsentModal`

**Files:**
- Modify: `demo_api_ui/src/components/TransactionConsentModal.tsx`

- [ ] **Step 1: Add recognize state and import**

At the top of `TransactionConsentModal.tsx`, add the import after existing imports:

```tsx
import RecognizeOverlay from './RecognizeOverlay';
```

Inside the component, after the `contactStep` / `contactInput` state declarations, add:

```tsx
const [recognizeStep, setRecognizeStep] = useState(false);
const [recognizeSessionToken, setRecognizeSessionToken] = useState<string | null>(null);
```

In the `useEffect` that resets on `!open`, add:

```tsx
setRecognizeStep(false);
setRecognizeSessionToken(null);
```

- [ ] **Step 2: Handle `mode: 'recognize'` in `handleConfirm`**

In `handleConfirm`, inside the `try` block, replace:

```tsx
if (data.mfaRequired) {
  setMfaDevices(data.devices || []);
  setMfaStep(true);
} else if (data.needsContact) {
  setContactStep(true);
} else {
  setOtpExpiresAt(data.otpExpiresAt || null);
  setOtpSent(data.otpSent || false);
  setMaskedContact(data.maskedContact || null);
  setOtpStep(true);
}
```

with:

```tsx
if (data.mode === 'recognize') {
  setRecognizeSessionToken(data.sessionToken);
  setRecognizeStep(true);
} else if (data.mode === 'onetime_fallback') {
  if (data.needsContact) {
    setContactStep(true);
  } else {
    setOtpExpiresAt(data.otpExpiresAt || null);
    setOtpSent(data.otpSent || false);
    setMaskedContact(data.maskedContact || null);
    setOtpStep(true);
  }
} else if (data.mfaRequired) {
  setMfaDevices(data.devices || []);
  setMfaStep(true);
} else if (data.needsContact) {
  setContactStep(true);
} else {
  setOtpExpiresAt(data.otpExpiresAt || null);
  setOtpSent(data.otpSent || false);
  setMaskedContact(data.maskedContact || null);
  setOtpStep(true);
}
```

- [ ] **Step 3: Add `handleRecognizeSuccess`, `handleRecognizeFallback`**

Add these handlers after `handleVerifyOtp`:

```tsx
const handleRecognizeSuccess = async (sdkResult: unknown) => {
  if (!challengeId) return;
  setSubmitting(true);
  try {
    await bffAxios.post(
      `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/verify-recognize`,
      { result: sdkResult },
    );
    setRecognizeStep(false);
    setAgentBlockedByConsentDecline(false);
    notifySuccess('Face verification complete. Proceeding with transaction…');
    onTransactionSuccess('Consent verified. Checking if additional verification is needed…');
  } catch (e: any) {
    const d = e.response?.data;
    if (d?.fallback) {
      // Server rejected face auth — fall back to OTP
      await handleRecognizeFallback();
    } else {
      notifyError(d?.message || e.message || 'Face verification failed.');
      setSubmitting(false);
    }
  }
};

const handleRecognizeFallback = async () => {
  if (!challengeId) return;
  setRecognizeStep(false);
  setRecognizeSessionToken(null);
  setSubmitting(true);
  try {
    const { data } = await bffAxios.post(
      `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/recognize-fallback`,
    );
    if (data.needsContact) {
      setContactStep(true);
    } else {
      setOtpExpiresAt(data.otpExpiresAt || null);
      setOtpSent(data.otpSent || false);
      setMaskedContact(data.maskedContact || null);
      setOtpStep(true);
    }
  } catch (e: any) {
    notifyError(e.response?.data?.message || 'Could not start backup verification.');
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 4: Render `RecognizeOverlay` from the modal**

In the returned JSX, add the overlay render just before the closing `</div>` of the outermost `transaction-consent-popup-overlay` div. Insert after the `denialOpen` block:

```tsx
{recognizeStep && recognizeSessionToken && (
  <RecognizeOverlay
    sessionToken={recognizeSessionToken}
    onSuccess={handleRecognizeSuccess}
    onFallback={handleRecognizeFallback}
    onCancel={() => {
      setRecognizeStep(false);
      setRecognizeSessionToken(null);
      onClose();
    }}
  />
)}
```

- [ ] **Step 5: Update the modal title to include `recognizeStep`**

In the `<h2>` title logic, add the recognize case:

```tsx
{recognizeStep
  ? 'Face verification'
  : otpStep
    ? 'Enter verification code'
    : mfaStep
      ? 'Select verification method'
      : contactStep
        ? 'Where should we send the code?'
        : 'Approve high-value transaction'}
```

- [ ] **Step 6: Build the UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -15
```
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/TransactionConsentModal.tsx
git commit -m "feat(recognize): wire RecognizeOverlay into TransactionConsentModal with OTP fallback"
```

---

## Task 6: Add `RecognizeEnrollCard` to Profile page

**Files:**
- Create: `demo_api_ui/src/components/RecognizeEnrollCard.tsx`
- Modify: `demo_api_ui/src/components/Profile.js`

- [ ] **Step 1: Create `RecognizeEnrollCard.tsx`**

Create `demo_api_ui/src/components/RecognizeEnrollCard.tsx`:

```tsx
import React, { FC, useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifySuccess } from '../utils/appToast';

declare global {
  interface Window {
    PingOneRecognize?: {
      init: (container: HTMLElement, options: unknown) => { destroy?: () => void };
    };
  }
}

const SDK_CDN = 'https://cdn.keyless.technology/web-sdk/latest/pingone-recognize.js';

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PingOneRecognize) { resolve(); return; }
    const existing = document.getElementById('recognize-sdk-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('SDK failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'recognize-sdk-script';
    script.src = SDK_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SDK failed to load'));
    document.head.appendChild(script);
  });
}

interface RecognizeEnrollCardProps {
  userId: string;
}

type EnrollState = 'idle' | 'enrolling' | 'unenrolling' | 'error';

const RecognizeEnrollCard: FC<RecognizeEnrollCardProps> = ({ userId }) => {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [state, setState] = useState<EnrollState>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ destroy?: () => void } | null>(null);

  const handleEnroll = async () => {
    setState('enrolling');
    setStatusMsg('');
    try {
      await loadSdkScript();
      if (!containerRef.current || !window.PingOneRecognize) throw new Error('SDK unavailable');
      instanceRef.current?.destroy?.();
      instanceRef.current = window.PingOneRecognize.init(containerRef.current, {
        capability: 'WEB_ENROLLMENT',
        username: userId,
        finishEventDelay: 500,
        errorEventDelay: 3000,
        onFinish: async () => {
          try {
            await bffAxios.post('/api/recognize/enroll');
            setEnrolled(true);
            setState('idle');
            notifySuccess('Face ID enrolled successfully');
          } catch (err: any) {
            setState('error');
            setStatusMsg(err.response?.data?.message || 'Enrollment failed.');
          }
        },
        onError: (err: unknown) => {
          console.warn('[RecognizeEnrollCard] SDK error:', err);
          setState('error');
          setStatusMsg('Face enrollment failed. Please try again.');
        },
      });
    } catch (err: any) {
      setState('error');
      setStatusMsg(err.message || 'Could not start enrollment.');
    }
  };

  const handleUnenroll = async () => {
    setState('unenrolling');
    setStatusMsg('');
    instanceRef.current?.destroy?.();
    instanceRef.current = null;
    try {
      await bffAxios.delete('/api/recognize/enroll');
      setEnrolled(false);
      setState('idle');
      notifySuccess('Face ID removed');
    } catch (err: any) {
      setState('error');
      notifyError(err.response?.data?.message || 'Unenroll failed.');
    } finally {
      if (state === 'unenrolling') setState('idle');
    }
  };

  useEffect(() => {
    return () => { instanceRef.current?.destroy?.(); };
  }, []);

  return (
    <div className="up-card">
      <div className="up-card__header">
        <span className="up-card__title">Face ID (PingOne Recognize)</span>
      </div>
      <div style={{ padding: '1rem' }}>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
          Enroll your face to use Face ID as your verification method for high-value transactions.
        </p>

        {enrolled === false && (
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.75rem' }}>
            Status: Not enrolled
          </p>
        )}
        {enrolled === true && (
          <p style={{ fontSize: '0.875rem', color: '#16a34a', marginBottom: '0.75rem' }}>
            ✅ Enrolled
          </p>
        )}

        {statusMsg && (
          <p style={{ fontSize: '0.875rem', color: '#dc2626', marginBottom: '0.75rem' }}>
            ❌ {statusMsg}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {enrolled !== true && (
            <button
              type="button"
              className="up-btn up-btn--add"
              onClick={handleEnroll}
              disabled={state === 'enrolling'}
            >
              {state === 'enrolling' ? 'Enrolling…' : 'Enroll Face ID'}
            </button>
          )}
          {enrolled === true && (
            <button
              type="button"
              className="up-btn up-btn--remove"
              onClick={handleUnenroll}
              disabled={state === 'unenrolling'}
            >
              {state === 'unenrolling' ? 'Removing…' : 'Remove Face ID'}
            </button>
          )}
        </div>

        {/* Enroll from Image: hidden file input for base64 selfie (silent enrollment via IDV) */}
        {enrolled !== true && (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              Or enroll from a verified selfie image (e.g. from PingOne Verify):
            </label>
            <input
              type="file"
              accept="image/jpeg"
              style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.8rem' }}
              disabled={state === 'enrolling'}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setState('enrolling');
                setStatusMsg('');
                const reader = new FileReader();
                reader.onload = async () => {
                  const base64 = (reader.result as string).split(',')[1];
                  try {
                    await bffAxios.post('/api/recognize/enroll', { imageBase64: base64, scenario: 'TRUSTED_SOURCE' });
                    setEnrolled(true);
                    setState('idle');
                    notifySuccess('Face ID enrolled from image');
                  } catch (err: any) {
                    setState('error');
                    setStatusMsg(err.response?.data?.message || 'Image enrollment failed.');
                  }
                };
                reader.readAsDataURL(file);
              }}
            />
          </div>
        )}

        <div ref={containerRef} style={{ marginTop: state === 'enrolling' ? '1rem' : 0 }} />
      </div>
    </div>
  );
};

export default RecognizeEnrollCard;
```

- [ ] **Step 2: Add `RecognizeEnrollCard` to `Profile.js`**

In `demo_api_ui/src/components/Profile.js`, add the import at the top:

```js
import RecognizeEnrollCard from './RecognizeEnrollCard';
```

Then, in the returned JSX, add the card after the MFA Devices `</div>` card closing tag (after the existing `up-card` for MFA):

```jsx
<RecognizeEnrollCard userId={user?.oauthId || user?.id || ''} />
```

- [ ] **Step 3: Build the UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -15
```
Expected: exit code 0

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/RecognizeEnrollCard.tsx demo_api_ui/src/components/Profile.js
git commit -m "feat(recognize): add RecognizeEnrollCard to Profile page"
```

---

## Task 7: Run full test suite and add REGRESSION_PLAN entry

**Files:**
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Run all API server tests**

```bash
cd demo_api_server && npm test 2>&1 | tail -30
```
Expected: all tests pass (including `recognizeConsent.regression`, `recognizeService.test`, and all pre-existing suites)

- [ ] **Step 2: Run UI tests**

```bash
cd demo_api_ui && npm test -- --watchAll=false 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 3: Add REGRESSION_PLAN §4 entry**

In `REGRESSION_PLAN.md`, under the §4 Bug Fix Log section, add:

```markdown
### [Phase X] PingOne Recognize WebSDK — face auth as HITL consent mode
- **What changed:** Added `recognize` as a fourth `hitl_consent_mfa_mode` value. `confirmChallenge` dispatches to `recognizeService.initiateSession`; on failure it falls back inline to one-time OTP. `verifyRecognize` advances challenge to `confirmed` on successful face auth; on rejection it signals `fallback:true` so the UI can call `/recognize-fallback` to pivot to OTP. New `RecognizeOverlay` full-page component loads WebSDK, handles `onFinish`/`onError`, auto-falls-back after 3000ms on error. `RecognizeEnrollCard` on Profile page handles enrollment/unenroll lifecycle.
- **Do not revert:** The fallback chain ensures transfers never get blocked by Recognize unavailability. Do not change `onetime_fallback` mode key — it is checked in `TransactionConsentModal.tsx` to differentiate fallback OTP from normal OTP.
- **New env vars required:** `RECOGNIZE_API_KEY`, `RECOGNIZE_TENANT_NAME`, `RECOGNIZE_BASE_URL` (optional, defaults to US region). All read via configStore.
```

- [ ] **Step 4: Final UI build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit code 0

- [ ] **Step 5: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(recognize): add REGRESSION_PLAN §4 entry for Recognize WebSDK integration"
```

---

## Manual Verification Checklist

After implementation, run through these steps manually:

1. Set `RECOGNIZE_API_KEY`, `RECOGNIZE_TENANT_NAME` in `.env` (get from your Recognize tenant)
2. Start services: `./run.sh`
3. Navigate to `/profile` → confirm "Face ID (PingOne Recognize)" card appears
4. Click "Enroll Face ID" → camera UI should appear → complete enrollment
5. Card should show ✅ Enrolled
6. Navigate to Admin → Feature Flags → set `hitl_consent_mfa_mode` to `recognize`
7. As a user, initiate a transfer over the consent threshold
8. Consent modal appears → tick checkbox → "Agree & continue"
9. `RecognizeOverlay` mounts full-page → camera appears → complete face scan
10. Overlay dismisses → transaction executes → success toast
11. **Fallback test:** Disconnect from network or set an invalid `RECOGNIZE_API_KEY` → repeat steps 7-8 → overlay should show fallback message and pivot to OTP entry after 3 seconds
12. Confirm UI build is still exit 0: `cd demo_api_ui && npm run build`
