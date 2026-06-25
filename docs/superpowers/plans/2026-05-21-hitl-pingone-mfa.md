# HITL PingOne MFA Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Augment the HITL consent challenge at $500+ to use real PingOne MFA (all enrolled devices — OTP, FIDO2, SMS) with a feature flag toggle, leaving the homegrown OTP path unchanged when the flag is off.

**Architecture:** A parallel branch is inserted inside `transactionConsentChallenge.js` at `confirmChallenge()`. When `ff_hitl_pingone_mfa_enabled=true` and amount ≥ step-up threshold, `confirmChallenge()` calls `mfaService.initiateDeviceAuth()` instead of generating a homegrown OTP. A new `verifyMfa()` function handles PingOne device selection and OTP/FIDO2 verification. `verifyAndConsumeChallenge()` is untouched and path-agnostic. Two new BFF routes (`select-device`, updated `verify-otp`) handle the PingOne path. The frontend `TransactionConsentModal.tsx` already has the `mfaStep`/`DeviceSelector` skeleton — it needs wiring to the real `confirm` response.

**Tech Stack:** Node.js/Express (BFF), CommonJS, `mfaService.js` (already wired), React + TypeScript (frontend), Jest (tests), `configStore.getEffective()` for feature flag, `req.session.oauthTokens.accessToken` for user access token.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `demo_api_server/services/transactionConsentChallenge.js` | Modify | Branch in `confirmChallenge()`, new `verifyMfa()`, export `verifyMfa` |
| `demo_api_server/routes/transactions.js` | Modify | New `POST .../select-device` route; update `verify-otp` route to detect `mfaPath` and call `verifyMfa()` instead of `verifyOtp()`; update `confirm` route response to pass through `mfaRequired`/`devices`; add GET challenge state fields |
| `demo_api_ui/src/components/TransactionConsentModal.tsx` | Modify | Wire `handleConfirm` to detect `mfaRequired` response and transition to `mfaStep`; wire `handleVerifyOtp` to send `deviceId` + `otp` on MFA path |
| `demo_api_server/src/__tests__/transactionConsentChallenge.test.js` | Modify | Add 4 new regression test cases |
| `demo_api_server/src/__tests__/hitlPingOneMfa.integration.test.js` | Create | New integration test for end-to-end MFA path |
| `REGRESSION_PLAN.md` | Modify | §1 and §4 entries |

---

## Task 1: Add `verifyMfa()` to `transactionConsentChallenge.js` (TDD)

**Files:**
- Modify: `demo_api_server/src/__tests__/transactionConsentChallenge.test.js`
- Modify: `demo_api_server/services/transactionConsentChallenge.js`

- [ ] **Step 1.1: Write failing tests for `verifyMfa()`**

Append to `demo_api_server/src/__tests__/transactionConsentChallenge.test.js`:

```javascript
// ── verifyMfa tests ──────────────────────────────────────────────────────────

jest.mock('../../services/mfaService', () => ({
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
}));

const mfaService = require('../../services/mfaService');

function makeReqWithMfaChallenge(challengeId, overrides = {}) {
  const ch = {
    userId: '5',
    snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
    status: 'otp_pending',
    mfaPath: true,
    daId: 'da-test-001',
    devices: [{ id: 'dev-1', type: 'EMAIL' }],
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    otpAttempts: 0,
    otpExpiresAt: Date.now() + 300_000,
  };
  const session = { txConsentChallenges: { [challengeId]: { ...ch, ...overrides.challenge } } };
  return { user: { id: '5', role: 'customer' }, session };
}

describe('verifyMfa', () => {
  const CHALLENGE_ID = 'mfa-challenge-abc';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects if challenge has no mfaPath flag', async () => {
    const req = makeReqWithMfaChallenge(CHALLENGE_ID, { challenge: { mfaPath: false } });
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', otp: '123456' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.json.error).toBe('not_mfa_path');
  });

  test('OTP path — calls submitOtp, promotes to confirmed', async () => {
    mfaService.submitOtp.mockResolvedValue({ status: 'COMPLETED' });
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', otp: '654321' });
    expect(mfaService.submitOtp).toHaveBeenCalledWith('da-test-001', 'dev-1', '654321', undefined);
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('confirmed');
  });

  test('demo bypass OTP 123123 promotes to confirmed without calling submitOtp', async () => {
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', otp: '123123' });
    expect(mfaService.submitOtp).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('confirmed');
  });

  test('FIDO2 path — calls submitFido2Assertion, promotes to confirmed', async () => {
    mfaService.submitFido2Assertion.mockResolvedValue({ status: 'COMPLETED' });
    const assertion = { id: 'cred-id', type: 'public-key' };
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', fido2Assertion: assertion }, 'https://api.ping.demo:4000');
    expect(mfaService.submitFido2Assertion).toHaveBeenCalledWith('da-test-001', assertion, undefined, 'https://api.ping.demo:4000');
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('confirmed');
  });

  test('PingOne OTP failure returns 400 otp_incorrect', async () => {
    mfaService.submitOtp.mockRejectedValue(Object.assign(new Error('wrong'), { code: 'otp_incorrect' }));
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', otp: '000000' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.json.error).toBe('otp_incorrect');
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd demo_api_server && npx jest transactionConsentChallenge --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `txConsent.verifyMfa is not a function`

- [ ] **Step 1.3: Implement `verifyMfa()` in `transactionConsentChallenge.js`**

Add after the closing `}` of `verifyOtp()` (before the `module.exports` block):

```javascript
/**
 * verifyMfa — PingOne MFA path for HITL consent challenges.
 * Called when challenge.mfaPath === true (ff_hitl_pingone_mfa_enabled + amount >= threshold).
 * Delegates OTP or FIDO2 assertion to mfaService; on success promotes to 'confirmed'.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {{ deviceId: string, otp?: string, fido2Assertion?: object }} params
 * @param {string} [origin]  Required for FIDO2 assertion (browser origin)
 */
async function verifyMfa(req, challengeId, params, origin) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (!ch.mfaPath) {
    return { ok: false, status: 409, json: { error: 'not_mfa_path', message: 'This challenge does not use PingOne MFA.' } };
  }
  if (ch.status !== 'otp_pending') {
    return { ok: false, status: 409, json: { error: 'otp_not_expected', message: 'No MFA challenge is pending for this challenge.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'otp_expired', message: 'The MFA challenge has expired. Start the transaction again.' } };
  }

  const { deviceId, otp, fido2Assertion } = params || {};
  const userAccessToken = req.session?.oauthTokens?.accessToken;
  const mfaService = require('./mfaService');

  // Demo bypass — accept without calling PingOne
  if (otp && String(otp).trim() === '123123') {
    console.log(`[ConsentChallenge] MFA demo bypass accepted challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  } else {
    try {
      if (fido2Assertion) {
        await mfaService.submitFido2Assertion(ch.daId, fido2Assertion, userAccessToken, origin);
      } else if (otp) {
        await mfaService.submitOtp(ch.daId, deviceId, otp, userAccessToken);
      } else {
        return { ok: false, status: 400, json: { error: 'missing_credential', message: 'Provide otp or fido2Assertion.' } };
      }
    } catch (err) {
      const code = err.code || 'mfa_failed';
      const msg = err.message || 'MFA verification failed.';
      console.warn(`[ConsentChallenge] MFA verify failed challenge=${challengeId.slice(0, 8)}… code=${code}`);
      return { ok: false, status: 400, json: { error: code, message: msg } };
    }
  }

  // Promote to confirmed
  const now = Date.now();
  ch.status           = 'confirmed';
  ch.confirmedAt      = now;
  ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
  delete ch.otpExpiresAt;
  delete ch.otpAttempts;

  console.log(`[ConsentChallenge] MFA verified challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  return { ok: true, challengeId, confirmExpiresAt: ch.confirmExpiresAt };
}
```

Also add `verifyMfa` to `module.exports`:

```javascript
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
  verifyOtp,
  verifyMfa,
  verifyAndConsumeChallenge,
};
```

- [ ] **Step 1.4: Run tests — confirm they pass**

```bash
cd demo_api_server && npx jest transactionConsentChallenge --no-coverage 2>&1 | tail -20
```
Expected: all tests pass (existing + 5 new `verifyMfa` tests)

- [ ] **Step 1.5: Commit**

```bash
git add demo_api_server/services/transactionConsentChallenge.js \
        demo_api_server/src/__tests__/transactionConsentChallenge.test.js
git commit -m "feat(hitl): add verifyMfa() to transactionConsentChallenge — PingOne MFA path"
```

---

## Task 2: Branch `confirmChallenge()` for PingOne MFA (TDD)

**Files:**
- Modify: `demo_api_server/src/__tests__/transactionConsentChallenge.test.js`
- Modify: `demo_api_server/services/transactionConsentChallenge.js`

- [ ] **Step 2.1: Write failing tests for `confirmChallenge()` PingOne MFA branch**

Append to `demo_api_server/src/__tests__/transactionConsentChallenge.test.js`:

```javascript
describe('confirmChallenge — PingOne MFA branch', () => {
  const CHALLENGE_ID = 'confirm-mfa-test';

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock configStore for this describe block
    jest.resetModules();
  });

  test('flag off — uses homegrown OTP path (returns otpSent, not mfaRequired)', async () => {
    jest.mock('../../services/configStore', () => ({
      getEffective: jest.fn((key) => {
        if (key === 'ff_hitl_pingone_mfa_enabled') return 'false';
        if (key === 'confirm_threshold_usd') return '250';
        return null;
      }),
    }));
    const txConsentLocal = require('../../services/transactionConsentChallenge');
    const req = makeReq({ session: { txConsentChallenges: {
      [CHALLENGE_ID]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }}});
    const result = await txConsentLocal.confirmChallenge(req, CHALLENGE_ID);
    // Should take homegrown path — result has otpSent or otpCodeFallback, not mfaRequired
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
  });

  test('flag on + amount >= 500 — calls initiateDeviceAuth and returns mfaRequired:true', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      daId: 'da-new-001',
      devices: [{ id: 'dev-1', type: 'EMAIL', email: 'u@example.com' }],
    });
    // Manually inject a challenge with mfaEnabled condition
    const req = makeReq({ session: { txConsentChallenges: {
      [CHALLENGE_ID]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    // Override configStore inline via jest.spyOn on the already-required module
    const configStore = require('../../services/configStore');
    const spy = jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_hitl_pingone_mfa_enabled') return 'true';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const result = await txConsent.confirmChallenge(req, CHALLENGE_ID);
    spy.mockRestore();
    expect(mfaService.initiateDeviceAuth).toHaveBeenCalledWith('5', 'user-token-abc');
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBe(true);
    expect(result.devices).toEqual([{ id: 'dev-1', type: 'EMAIL', email: 'u@example.com' }]);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].mfaPath).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].daId).toBe('da-new-001');
  });

  test('flag on but amount < 500 — homegrown OTP path taken', async () => {
    const configStore = require('../../services/configStore');
    const spy = jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_hitl_pingone_mfa_enabled') return 'true';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [CHALLENGE_ID + '-low']: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 300, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }}});
    const result = await txConsent.confirmChallenge(req, CHALLENGE_ID + '-low');
    spy.mockRestore();
    expect(mfaService.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
cd demo_api_server && npx jest transactionConsentChallenge --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `mfaRequired` undefined in second test

- [ ] **Step 2.3: Add PingOne MFA branch to `confirmChallenge()` in `transactionConsentChallenge.js`**

Add a helper to get the step-up threshold at the top of the file (after `getConfirmThreshold`):

```javascript
const STEP_UP_THRESHOLD_DEFAULT = 500;
function getStepUpThreshold() {
  const v = configStore.getEffective('confirm_stepup_threshold_usd');
  const n = Number(v);
  return (v && !isNaN(n) && n > 0) ? n : STEP_UP_THRESHOLD_DEFAULT;
}
```

Replace the `// Generate OTP and store its hash` block inside `confirmChallenge()` with:

```javascript
  // ── PingOne MFA branch ────────────────────────────────────────────────────
  const pingoneMfaEnabled = configStore.getEffective('ff_hitl_pingone_mfa_enabled') === 'true';
  const stepUpThreshold = getStepUpThreshold();
  const challengeAmount = ch.snapshot.amount;

  if (pingoneMfaEnabled && challengeAmount >= stepUpThreshold) {
    const userAccessToken = req.session?.oauthTokens?.accessToken;
    const mfaService = require('./mfaService');
    let daId, devices;
    try {
      const initiated = await mfaService.initiateDeviceAuth(req.user.id, userAccessToken);
      daId = initiated.daId;
      devices = initiated.devices || [];
    } catch (err) {
      console.warn(`[ConsentChallenge] initiateDeviceAuth failed: ${err.message}`);
      return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Could not start MFA challenge. Try again.' } };
    }

    ch.mfaPath      = true;
    ch.daId         = daId;
    ch.devices      = devices;
    ch.otpAttempts  = 0;
    ch.otpExpiresAt = now + OTP_TTL_MS;
    ch.status       = 'otp_pending';

    console.log(`[ConsentChallenge] PingOne MFA initiated challenge=${challengeId.slice(0, 8)}… daId=${daId} user=${req.user.id}`);
    return { ok: true, challengeId, mfaRequired: true, devices };
  }
  // ── End PingOne MFA branch ───────────────────────────────────────────────

  // Generate OTP and store its hash (homegrown path — unchanged)
```

- [ ] **Step 2.4: Run tests — confirm they pass**

```bash
cd demo_api_server && npx jest transactionConsentChallenge --no-coverage 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 2.5: Commit**

```bash
git add demo_api_server/services/transactionConsentChallenge.js \
        demo_api_server/src/__tests__/transactionConsentChallenge.test.js
git commit -m "feat(hitl): branch confirmChallenge for PingOne MFA at step-up threshold"
```

---

## Task 3: Add `select-device` route and update `verify-otp` route in `transactions.js`

**Files:**
- Modify: `demo_api_server/routes/transactions.js`

- [ ] **Step 3.1: Add `POST /consent-challenge/:challengeId/select-device` route**

Insert after the existing `router.post('/consent-challenge/:challengeId/confirm', ...)` handler (after its closing `)`):

```javascript
router.post(
  '/consent-challenge/:challengeId/select-device',
  authenticateToken,
  async (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device_id', message: 'deviceId is required.' });

    const st = (req.session.txConsentChallenges || {});
    const ch = st[req.params.challengeId];
    if (!ch || ch.userId !== req.user.id) {
      return res.status(404).json({ error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' });
    }
    if (!ch.mfaPath || !ch.daId) {
      return res.status(409).json({ error: 'not_mfa_path', message: 'This challenge does not use PingOne MFA.' });
    }

    const mfaService = require('../services/mfaService');
    try {
      const result = await mfaService.selectDevice(ch.daId, deviceId);
      // Determine what the challenge expects next based on selected device type
      const device = (ch.devices || []).find((d) => d.id === deviceId);
      const isFido2 = device && device.type === 'FIDO2';
      req.session.save((saveErr) => {
        if (saveErr) console.error('[ConsentChallenge] session save error (select-device):', saveErr);
        return res.status(200).json({
          method: isFido2 ? 'fido2' : 'otp',
          deviceId,
          ...(result._debug ? { _debug: result._debug } : {}),
        });
      });
    } catch (err) {
      const code = err.code || 'device_select_failed';
      return res.status(502).json({ error: code, message: err.message || 'Could not select MFA device.' });
    }
  },
);
```

- [ ] **Step 3.2: Update `verify-otp` route to detect `mfaPath` and call `verifyMfa()`**

Replace the existing `router.post('/consent-challenge/:challengeId/verify-otp', ...)` handler with:

```javascript
router.post(
  '/consent-challenge/:challengeId/verify-otp',
  authenticateToken,
  async (req, res) => {
    const { otpCode, deviceId, otp, fido2Assertion } = req.body || {};
    const st = (req.session.txConsentChallenges || {});
    const ch = st[req.params.challengeId];

    // Route to PingOne MFA path when challenge was initiated that way
    if (ch && ch.mfaPath) {
      const origin = req.headers.origin || req.headers.referer || null;
      const result = await txConsent.verifyMfa(
        req,
        req.params.challengeId,
        { deviceId, otp: otp || otpCode, fido2Assertion },
        origin,
      );
      if (!result.ok) return res.status(result.status).json(result.json);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[ConsentChallenge] session save error (verify-otp mfa):', saveErr);
        return res.status(200).json({
          challengeId: result.challengeId,
          confirmExpiresAt: result.confirmExpiresAt,
        });
      });
      return;
    }

    // Homegrown OTP path (unchanged)
    const result = txConsent.verifyOtp(req, req.params.challengeId, otpCode);
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (verify-otp):', saveErr);
      return res.status(200).json({
        challengeId: result.challengeId,
        confirmExpiresAt: result.confirmExpiresAt,
      });
    });
  },
);
```

- [ ] **Step 3.3: Update `confirm` route to pass through `mfaRequired` and `devices`**

Replace the response block inside the existing `router.post('/consent-challenge/:challengeId/confirm', ...)` session.save callback:

```javascript
      return res.status(200).json({
        challengeId: result.challengeId,
        // PingOne MFA path
        ...(result.mfaRequired
          ? { mfaRequired: true, devices: result.devices }
          // Homegrown OTP path (unchanged fields)
          : {
              otpSent: result.otpSent,
              otpExpiresAt: result.otpExpiresAt,
              ...(result.otpCodeFallback ? { otpCodeFallback: result.otpCodeFallback } : {}),
            }),
      });
```

- [ ] **Step 3.4: Run existing transaction tests to verify no regressions**

```bash
cd demo_api_server && npx jest hitlRoute.regression hitlRoute.integration --no-coverage 2>&1 | tail -20
```
Expected: all pass

- [ ] **Step 3.5: Commit**

```bash
git add demo_api_server/routes/transactions.js
git commit -m "feat(hitl): add select-device route, update verify-otp and confirm to support PingOne MFA path"
```

---

## Task 4: Wire `TransactionConsentModal.tsx` to PingOne MFA path

**Files:**
- Modify: `demo_api_ui/src/components/TransactionConsentModal.tsx`

The modal already has `mfaStep`, `mfaDevices`, `selectedDeviceId`, and `handleSelectDevice`. It already imports `DeviceSelector`. What's missing: `handleConfirm` doesn't detect the `mfaRequired` response, and `handleVerifyOtp` doesn't send `deviceId`/`otp` on the PingOne path.

- [ ] **Step 4.1: Update `handleConfirm` to detect `mfaRequired` response**

Replace the existing `handleConfirm` function:

```typescript
  const handleConfirm = async () => {
    if (!agreed || submitting || !snapshot || !challengeId || !user?.id) return;
    setSubmitting(true);
    try {
      const { data } = await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/confirm`,
      );
      if (data.mfaRequired) {
        // PingOne MFA path — show device picker
        setMfaDevices(data.devices || []);
        setMfaStep(true);
      } else {
        // Homegrown OTP path — unchanged
        setOtpExpiresAt(data.otpExpiresAt || null);
        setOtpSent(data.otpSent || false);
        setOtpStep(true);
      }
    } catch (e: any) {
      const d = e.response?.data;
      const status = e.response?.status;
      if (status === 401) {
        notifyError(
          "Session expired. Please sign in again to complete this transaction.",
        );
      } else {
        notifyError(
          d?.message ||
            d?.error_description ||
            d?.error ||
            e.message ||
            "Could not confirm consent.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };
```

- [ ] **Step 4.2: Update `handleVerifyOtp` to send `deviceId` + `otp` on PingOne path**

Replace the existing `handleVerifyOtp` function:

```typescript
  const handleVerifyOtp = async () => {
    if (!otpCode || otpVerifying || !challengeId || !user?.id || !snapshot)
      return;
    setOtpError("");
    setOtpVerifying(true);
    try {
      // On the PingOne MFA path, send deviceId + otp; on homegrown path send otpCode
      const payload = selectedDeviceId
        ? { deviceId: selectedDeviceId, otp: otpCode }
        : { otpCode };
      await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/verify-otp`,
        payload,
      );
      setAgentBlockedByConsentDecline(false);
      notifySuccess("Consent verified. Proceeding with transaction...");
      onTransactionSuccess(
        "Consent verified. Checking if additional verification is needed...",
      );
    } catch (e: any) {
      const status = e.response?.status;
      const d = e.response?.data;
      if (status === 428) {
        notifyWarning(
          "Additional verification (step-up MFA) is required. After you complete it, start the high-value transaction again from the dashboard.",
        );
        return;
      }
      if (d?.error === "otp_locked") {
        notifyError(
          "Too many incorrect attempts. The verification has been locked — please start the transaction again.",
        );
        onClose();
        return;
      }
      if (d?.error === "otp_expired") {
        notifyError(
          "Verification code expired. Please start the transaction again.",
        );
        onClose();
        return;
      }
      const inline = d?.error === "otp_incorrect" || d?.error === "mfa_failed";
      if (inline) {
        setOtpError(d.message || "Incorrect code. Try again.");
        setOtpCode("");
        otpInputRef.current?.focus();
      } else {
        notifyError(
          d?.message ||
            d?.error_description ||
            d?.error ||
            e.message ||
            "Request failed.",
        );
      }
    } finally {
      setOtpVerifying(false);
    }
  };
```

- [ ] **Step 4.3: Build the UI and confirm exit code 0**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```
Expected: exit code 0, no TypeScript errors

- [ ] **Step 4.4: Commit**

```bash
git add demo_api_ui/src/components/TransactionConsentModal.tsx
git commit -m "feat(hitl): wire TransactionConsentModal to PingOne MFA device picker path"
```

---

## Task 5: Integration test for PingOne MFA HITL end-to-end

**Files:**
- Create: `demo_api_server/src/__tests__/hitlPingOneMfa.integration.test.js`

- [ ] **Step 5.1: Write the integration test**

Create `demo_api_server/src/__tests__/hitlPingOneMfa.integration.test.js`:

```javascript
/**
 * Integration test: HITL + PingOne MFA end-to-end.
 * Uses real configStore with FF_HITL_PINGONE_MFA_ENABLED=true injected.
 * Mocks mfaService to avoid real PingOne calls.
 * Tests: create → confirm (gets devices) → select-device → verify-otp → consume.
 */
'use strict';

const express = require('express');
const request = require('supertest');

// Mock mfaService BEFORE requiring routes
jest.mock('../../services/mfaService', () => ({
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
}));

// Mock emailService to prevent real email calls
jest.mock('../../services/emailService', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendTransactionConfirmation: jest.fn().mockResolvedValue({}),
}));

// Mock data store with test accounts
jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    if (id === 'acc-from') return { id: 'acc-from', userId: 'user-mfa-1', balance: 5000 };
    if (id === 'acc-to') return { id: 'acc-to', userId: 'user-mfa-1', balance: 1000 };
    return null;
  }),
  getAccountsByUserId: jest.fn(() => [
    { id: 'acc-from', userId: 'user-mfa-1', balance: 5000 },
    { id: 'acc-to', userId: 'user-mfa-1', balance: 1000 },
  ]),
  getUserById: jest.fn(() => ({ id: 'user-mfa-1', firstName: 'Test', lastName: 'User' })),
}));

// Mock auth middleware to inject test user
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: 'user-mfa-1', role: 'customer', username: 'testuser' };
    next();
  },
  requireScopes: () => (_req, _res, next) => next(),
}));

// Mock posthog
jest.mock('../../services/posthog', () => ({ capture: jest.fn() }));

// Mock demoScenarioStore
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn().mockResolvedValue({}),
  save: jest.fn().mockResolvedValue({}),
}));

const mfaService = require('../../services/mfaService');

// Build a minimal express app with session and the transactions router
function buildApp(sessionOverrides = {}) {
  const session = require('express-session');
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    // MemoryStore is fine for tests
  }));
  // Inject oauthTokens into session for routes that need user access token
  app.use((req, _res, next) => {
    req.session.oauthTokens = { accessToken: 'test-user-access-token', ...sessionOverrides };
    next();
  });
  const txRouter = require('../../routes/transactions');
  app.use('/api/transactions', txRouter);
  return app;
}

describe('HITL + PingOne MFA end-to-end', () => {
  let app;
  let agent;

  beforeAll(() => {
    // Enable PingOne MFA flag for all tests in this suite
    const configStore = require('../../services/configStore');
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_hitl_pingone_mfa_enabled') return 'true';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      if (key === 'ff_hitl_enabled') return 'true';
      return null;
    });
    app = buildApp();
    agent = request.agent(app); // sticky cookies for session
  });

  afterAll(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  let challengeId;

  test('Step 1: POST /consent-challenge creates a challenge for $600 withdrawal', async () => {
    const res = await agent
      .post('/api/transactions/consent-challenge')
      .send({ type: 'withdrawal', amount: 600, fromAccountId: 'acc-from', description: 'Test MFA' });
    expect(res.status).toBe(201);
    expect(res.body.challengeId).toBeDefined();
    challengeId = res.body.challengeId;
  });

  test('Step 2: POST /confirm returns mfaRequired:true with devices', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      daId: 'da-integration-001',
      devices: [
        { id: 'dev-email', type: 'EMAIL', email: 'test@example.com' },
        { id: 'dev-sms', type: 'SMS', phone: '+15551234567' },
      ],
    });
    const res = await agent
      .post(`/api/transactions/consent-challenge/${challengeId}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.devices).toHaveLength(2);
    expect(mfaService.initiateDeviceAuth).toHaveBeenCalledWith('user-mfa-1', 'test-user-access-token');
  });

  test('Step 3: POST /select-device returns method:otp for EMAIL device', async () => {
    mfaService.selectDevice.mockResolvedValue({ _debug: null });
    const res = await agent
      .post(`/api/transactions/consent-challenge/${challengeId}/select-device`)
      .send({ deviceId: 'dev-email' });
    expect(res.status).toBe(200);
    expect(res.body.method).toBe('otp');
    expect(res.body.deviceId).toBe('dev-email');
  });

  test('Step 4: POST /verify-otp with deviceId+otp calls submitOtp and confirms challenge', async () => {
    mfaService.submitOtp.mockResolvedValue({ status: 'COMPLETED' });
    const res = await agent
      .post(`/api/transactions/consent-challenge/${challengeId}/verify-otp`)
      .send({ deviceId: 'dev-email', otp: '654321' });
    expect(res.status).toBe(200);
    expect(res.body.confirmExpiresAt).toBeDefined();
    expect(mfaService.submitOtp).toHaveBeenCalledWith('da-integration-001', 'dev-email', '654321', 'test-user-access-token');
  });

  test('Step 4 (bypass): 123123 OTP works without calling submitOtp', async () => {
    // Create a new challenge for this test
    const res1 = await agent
      .post('/api/transactions/consent-challenge')
      .send({ type: 'withdrawal', amount: 600, fromAccountId: 'acc-from', description: 'Bypass test' });
    const bypassId = res1.body.challengeId;
    mfaService.initiateDeviceAuth.mockResolvedValue({ daId: 'da-bypass', devices: [{ id: 'dev-1', type: 'EMAIL' }] });
    await agent.post(`/api/transactions/consent-challenge/${bypassId}/confirm`);
    await agent.post(`/api/transactions/consent-challenge/${bypassId}/select-device`).send({ deviceId: 'dev-1' });
    const res2 = await agent
      .post(`/api/transactions/consent-challenge/${bypassId}/verify-otp`)
      .send({ deviceId: 'dev-1', otp: '123123' });
    expect(res2.status).toBe(200);
    expect(mfaService.submitOtp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run the integration test**

```bash
cd demo_api_server && npx jest hitlPingOneMfa.integration --no-coverage 2>&1 | tail -30
```
Expected: all 5 tests pass

- [ ] **Step 5.3: Run the full existing consent challenge test suite to confirm no regressions**

```bash
cd demo_api_server && npx jest transactionConsentChallenge hitlRoute.regression hitlRoute.integration --no-coverage 2>&1 | tail -20
```
Expected: all pass

- [ ] **Step 5.4: Commit**

```bash
git add demo_api_server/src/__tests__/hitlPingOneMfa.integration.test.js
git commit -m "test(hitl): integration test for PingOne MFA HITL end-to-end flow"
```

---

## Task 6: Update `REGRESSION_PLAN.md` and do a full test run

**Files:**
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 6.1: Add §1 entry for the MFA branch**

Find the `transactionConsentChallenge.js` row in REGRESSION_PLAN.md §1 and append a note, or add a new row:

```markdown
| `demo_api_server/services/transactionConsentChallenge.js` | `confirmChallenge()` has a PingOne MFA branch gated by `ff_hitl_pingone_mfa_enabled=true` AND `amount >= confirm_stepup_threshold_usd`. `verifyMfa()` is the PingOne path; `verifyOtp()` is homegrown. `verifyAndConsumeChallenge()` is path-agnostic — must stay that way. Demo bypass OTP `123123` works on both paths. |
```

- [ ] **Step 6.2: Add §4 bug fix / feature log entry**

Under §4 Bug Fix Log, add:

```markdown
### [2026-05-21] HITL PingOne MFA Integration
- **Feature:** `ff_hitl_pingone_mfa_enabled` flag routes $500+ HITL challenges to real PingOne `deviceAuthentications` (all enrolled devices: OTP, FIDO2, SMS). Flag off = homegrown email OTP unchanged.
- **Files:** `transactionConsentChallenge.js`, `routes/transactions.js`, `TransactionConsentModal.tsx`
- **Tests:** `transactionConsentChallenge.test.js` (5 new), `hitlPingOneMfa.integration.test.js` (5 new)
```

- [ ] **Step 6.3: Run full BFF test suite**

```bash
cd demo_api_server && npx jest --no-coverage 2>&1 | tail -30
```
Expected: all suites pass (or pre-existing failures only — no new failures introduced)

- [ ] **Step 6.4: Build the UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```
Expected: exit code 0

- [ ] **Step 6.5: Final commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): add HITL PingOne MFA to §1 protected list and §4 log"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `ff_hitl_pingone_mfa_enabled` flag, default false | Task 2 (`confirmChallenge` reads flag) |
| `confirmChallenge` calls `initiateDeviceAuth` when flag+threshold | Task 2 |
| `verifyMfa()` new function — OTP + FIDO2 + demo bypass | Task 1 |
| `mfaPath`, `daId`, `devices` stored in session | Task 2 |
| `POST /select-device` new route | Task 3 |
| `POST /verify-otp` detects `mfaPath` and routes accordingly | Task 3 |
| `POST /confirm` passes through `mfaRequired`/`devices` | Task 3 |
| Frontend `handleConfirm` transitions to device picker on `mfaRequired` | Task 4 |
| Frontend `handleVerifyOtp` sends `deviceId`+`otp` on PingOne path | Task 4 |
| Regression tests: 4 cases for `confirmChallenge` + `verifyMfa` | Tasks 1, 2 |
| Integration test end-to-end | Task 5 |
| `verifyAndConsumeChallenge` untouched | No task — it's never modified |
| REGRESSION_PLAN.md §1 + §4 | Task 6 |
| `123123` bypass on both paths | Task 1 step 1.1, Task 5 step 5.1 |

All spec requirements covered. No placeholders. Type/method names consistent throughout (`verifyMfa`, `daId`, `mfaPath`, `mfaRequired`, `devices`, `selectDevice`, `submitOtp`, `submitFido2Assertion`).
