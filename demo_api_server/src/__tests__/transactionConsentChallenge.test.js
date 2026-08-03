/**
 * Unit tests for Phase 170: Transfer HITL enforcement in transactionConsentChallenge.
 * Verifies that ALL transfers require consent challenges regardless of amount,
 * while withdrawals/deposits preserve the existing $500 threshold.
 */
'use strict';

const txConsent = require('../../services/transactionConsentChallenge');

// Mock dataStore to provide account data for validateIntent
jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    const accounts = {
      'acc1': { id: 'acc1', userId: '5', balance: 10000 },
      'acc2': { id: 'acc2', userId: '5', balance: 5000 },
    };
    return accounts[id] || null;
  }),
  getAccountsByUserId: jest.fn(() => [
    { id: 'acc1', userId: '5', balance: 10000 },
    { id: 'acc2', userId: '5', balance: 5000 },
  ]),
  getUserById: jest.fn(() => null),
}));

function makeReq(overrides = {}) {
  return {
    user: { id: '5', role: 'customer', ...overrides.user },
    session: { txConsentChallenges: {}, ...overrides.session },
  };
}

describe('Phase 170 — Transfer HITL enforcement', () => {
  describe('createChallenge — transfer type always requires challenge', () => {
    test('transfer $1.00 creates a challenge (below $500 threshold)', () => {
      const req = makeReq();
      const body = { type: 'transfer', amount: 1.00, fromAccountId: 'acc1', toAccountId: 'acc2', description: 'Test' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(true);
      expect(result.challengeId).toBeDefined();
      expect(result.challengeId.length).toBeGreaterThan(0);
    });

    test('transfer $0.01 creates a challenge (minimal amount)', () => {
      const req = makeReq();
      const body = { type: 'transfer', amount: 0.01, fromAccountId: 'acc1', toAccountId: 'acc2', description: 'Penny' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(true);
      expect(result.challengeId).toBeDefined();
    });

    test('transfer $499.99 creates a challenge (just below old threshold)', () => {
      const req = makeReq();
      const body = { type: 'transfer', amount: 499.99, fromAccountId: 'acc1', toAccountId: 'acc2', description: 'Near threshold' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(true);
      expect(result.challengeId).toBeDefined();
    });

    test('transfer $501.00 creates a challenge (above threshold — always did)', () => {
      const req = makeReq();
      const body = { type: 'transfer', amount: 501.00, fromAccountId: 'acc1', toAccountId: 'acc2', description: 'Large' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(true);
      expect(result.challengeId).toBeDefined();
    });
  });

  describe('createChallenge — withdrawal/deposit threshold preserved', () => {
    test('withdrawal $100 rejected (below $500 threshold)', () => {
      const req = makeReq();
      const body = { type: 'withdrawal', amount: 100.00, fromAccountId: 'acc1', description: 'Withdrawal' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.json.error).toBe('consent_challenge_not_required');
    });

    test('withdrawal $501 creates a challenge (above threshold)', () => {
      const req = makeReq();
      const body = { type: 'withdrawal', amount: 501.00, fromAccountId: 'acc1', description: 'Large withdrawal' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(true);
      expect(result.challengeId).toBeDefined();
    });

    test('deposit $10000 rejected (deposits use threshold, not transfer logic)', () => {
      const req = makeReq();
      const body = { type: 'deposit', amount: 100.00, toAccountId: 'acc1', description: 'Deposit' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(false);
      expect(result.json.error).toBe('consent_challenge_not_required');
    });
  });

  describe('createChallenge — admin bypass preserved', () => {
    test('admin transfer is rejected with consent_challenge_not_applicable', () => {
      const req = makeReq({ user: { role: 'admin' } });
      const body = { type: 'transfer', amount: 1.00, fromAccountId: 'acc1', toAccountId: 'acc2', description: 'Admin' };
      const result = txConsent.createChallenge(req, body);
      expect(result.ok).toBe(false);
      expect(result.json.error).toBe('consent_challenge_not_applicable');
    });
  });
});

// ── verifyMfa tests ──────────────────────────────────────────────────────────

jest.mock('../../services/mfaService', () => ({
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
  initiateOneTimeOtp: jest.fn(),
  verifyOneTimeOtp: jest.fn(),
  getPingOneUserContact: jest.fn(),
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
    // A challenge only reaches an MFA ceremony at/above the step-up threshold,
    // so a verified ceremony must also discharge the transactions-route step-up
    // gate — without this the post-consent retry answered RFC 9470 401
    // step_up_required for the MFA the user just completed.
    expect(req.session.stepUpVerified).toBeGreaterThan(Date.now());
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
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { deviceId: 'dev-1', fido2Assertion: assertion }, 'https://demo-api-server:3001');
    expect(mfaService.submitFido2Assertion).toHaveBeenCalledWith('da-test-001', assertion, undefined, 'https://demo-api-server:3001');
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

describe('confirmChallenge — PingOne MFA branch', () => {
  const CHALLENGE_ID = 'confirm-mfa-test';

  // jest.resetModules() runs in afterEach (setup.js), so each test must re-require
  // modules fresh to ensure spies on configStore reach the same instance that
  // transactionConsentChallenge.js holds internally.
  function freshRequires() {
    jest.mock('../../services/mfaService', () => ({
      initiateDeviceAuth: jest.fn(),
      selectDevice: jest.fn(),
      submitOtp: jest.fn(),
      submitFido2Assertion: jest.fn(),
      initiateOneTimeOtp: jest.fn(),
      verifyOneTimeOtp: jest.fn(),
      getPingOneUserContact: jest.fn(),
    }));
    jest.mock('../../data/store', () => ({
      getAccountById: jest.fn((id) => {
        const accounts = {
          'acc1': { id: 'acc1', userId: '5', balance: 10000 },
          'acc2': { id: 'acc2', userId: '5', balance: 5000 },
        };
        return accounts[id] || null;
      }),
      getAccountsByUserId: jest.fn(() => [
        { id: 'acc1', userId: '5', balance: 10000 },
        { id: 'acc2', userId: '5', balance: 5000 },
      ]),
      getUserById: jest.fn(() => null),
    }));
    const txConsentFresh = require('../../services/transactionConsentChallenge');
    const mfaServiceFresh = require('../../services/mfaService');
    const configStoreFresh = require('../../services/configStore');
    return { txConsentFresh, mfaServiceFresh, configStoreFresh };
  }

  test('device_picker mode + amount >= 500 — calls initiateDeviceAuth and returns mfaRequired:true', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.initiateDeviceAuth.mockResolvedValue({
      id: 'da-new-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: { devices: [{ id: 'dev-1', type: 'EMAIL', email: 'u@example.com' }] },
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [CHALLENGE_ID]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'device_picker';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const result = await txConsentFresh.confirmChallenge(req, CHALLENGE_ID);
    spy.mockRestore();
    expect(mfaServiceFresh.initiateDeviceAuth).toHaveBeenCalledWith('5', 'user-token-abc');
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBe(true);
    expect(result.devices).toEqual([{ id: 'dev-1', type: 'EMAIL', email: 'u@example.com' }]);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].mfaPath).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].daId).toBe('da-new-001');
  });

  test('device_picker mode but amount < 500 — homegrown OTP path taken', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'device_picker';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-low`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 300, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }}});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-low`);
    spy.mockRestore();
    expect(mfaServiceFresh.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
    // Consent-only proves no MFA — it must never discharge the step-up gate.
    expect(req.session.stepUpVerified).toBeUndefined();
  });

  test('homegrown mode — homegrown OTP path taken regardless of amount', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'homegrown';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-homegrown`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }}});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-homegrown`);
    spy.mockRestore();
    expect(mfaServiceFresh.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
  });

  // device-picker uses the user's session token, so a PingOne INVALID_TOKEN here is
  // only "sign in again" when that token is ACTUALLY expired — otherwise re-login
  // mints another identically-rejected token and the prompt would loop.
  function deviceAuthTokenErr() {
    return Object.assign(new Error('You do not have access to this resource.'), {
      status: 401,
      code: 'token_expired',
      pingError: { code: 'ACCESS_FAILED', details: [{ code: 'INVALID_TOKEN', target: 'Authentication' }] },
    });
  }
  function devicePickerReq(suffix, tokenExpiresAt) {
    return makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-${suffix}`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc', expiresAt: tokenExpiresAt } }});
  }
  function devicePickerConfig(configStoreFresh) {
    return jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'device_picker';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
  }

  // Every other device_picker test above mocks configStore.getEffective directly
  // (devicePickerConfig()) to isolate this file's branching logic from configStore.
  // This test does the opposite on purpose: it drives the REAL configStore end to
  // end — no getEffective mock at all — to prove Tasks 1-2 actually close the gap
  // (confirm_stepup_threshold_usd registered in FIELD_DEFS + writable via the admin
  // settings route). A mock that just hands back the same literal values passed to
  // setConfig() would pass even if the registration bug were still present, so it
  // can't stand in for this check.
  describe('device_picker mode — end-to-end with the real configStore (not mocked)', () => {
    it('respects a threshold set via PUT /api/admin/settings, not just the scopeTopology fallback', async () => {
      const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();

      // configStore is LMDB-backed and shares one persistent store across the whole
      // Jest worker; jest.resetModules() only clears the require cache, not the
      // on-disk rows. Wipe leaked rows from sibling suites before writing ours, same
      // guard as thresholdsToSimulatedAuthorize.regression.test.js.
      await configStoreFresh.resetConfig();

      // The consent-challenge step-up threshold now reads the SAME source of
      // truth as the agent authorize path — mfa_threshold_usd (written by the
      // thresholds API / admin settings) — so the two can never disagree on
      // which amount needs MFA. Set it to 900 for this case.
      await configStoreFresh.setConfig({
        hitl_consent_mfa_mode: 'device_picker',
        mfa_threshold_usd: '900',
        confirm_threshold_usd: '250',
      });

      // Amount 800 is below the 900 threshold now in effect -- should NOT trigger
      // the device-picker MFA path (before this fix, the hardcoded 500 fallback
      // would have incorrectly triggered it, since 800 >= 500).
      const req = makeReq({ session: { txConsentChallenges: {
        [`${CHALLENGE_ID}-real-1`]: {
          userId: '5', snapshot: { type: 'withdrawal', amount: 800, fromAccountId: 'acc1', toAccountId: null, description: '' },
          status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
        },
      }}});
      const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-real-1`);
      expect(mfaServiceFresh.initiateDeviceAuth).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.mfaRequired).toBeUndefined();
    });
  });

  test('device_picker + FRESH token but PingOne INVALID_TOKEN → 502 (no session_expired re-auth loop)', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.initiateDeviceAuth.mockRejectedValue(deviceAuthTokenErr());
    const spy = devicePickerConfig(configStoreFresh);
    const req = devicePickerReq('fresh', Date.now() + 600_000); // token still valid
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-fresh`);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.json.error).toBe('mfa_init_failed');
  });

  test('device_picker + ACTUALLY-expired token + INVALID_TOKEN → 401 session_expired', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.initiateDeviceAuth.mockRejectedValue(deviceAuthTokenErr());
    const spy = devicePickerConfig(configStoreFresh);
    const req = devicePickerReq('expired', Date.now() - 1000); // token past expiry
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-expired`);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.json.error).toBe('session_expired');
    expect(result.json.requiresLogin).toBe(true);
  });
});

// ── One-time OTP path tests ──────────────────────────────────────────────────

describe('confirmChallenge — one-time OTP branch (hitl_consent_mfa_mode=onetime)', () => {
  const CHALLENGE_ID = 'onetime-test';

  function freshRequires() {
    jest.mock('../../services/mfaService', () => ({
      initiateDeviceAuth: jest.fn(),
      selectDevice: jest.fn(),
      submitOtp: jest.fn(),
      submitFido2Assertion: jest.fn(),
      initiateOneTimeOtp: jest.fn(),
      verifyOneTimeOtp: jest.fn(),
      getPingOneUserContact: jest.fn(),
    }));
    jest.mock('../../data/store', () => ({
      getAccountById: jest.fn((id) => {
        const accounts = {
          'acc1': { id: 'acc1', userId: '5', balance: 10000 },
          'acc2': { id: 'acc2', userId: '5', balance: 5000 },
        };
        return accounts[id] || null;
      }),
      getAccountsByUserId: jest.fn(() => [
        { id: 'acc1', userId: '5', balance: 10000 },
        { id: 'acc2', userId: '5', balance: 5000 },
      ]),
      getUserById: jest.fn(() => null),
    }));
    const txConsentFresh = require('../../services/transactionConsentChallenge');
    const mfaServiceFresh = require('../../services/mfaService');
    const configStoreFresh = require('../../services/configStore');
    return { txConsentFresh, mfaServiceFresh, configStoreFresh };
  }

  test('onetime mode — calls getPingOneUserContact + initiateOneTimeOtp, returns otpSent + maskedContact', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    mfaServiceFresh.initiateOneTimeOtp.mockResolvedValue({
      id: 'da-onetime-001',
      status: 'OTP_REQUIRED',
      _embedded: { devices: [{ type: 'EMAIL', email: 'us**@example.com' }] },
    });
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'onetime';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [CHALLENGE_ID]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    const result = await txConsentFresh.confirmChallenge(req, CHALLENGE_ID);
    spy.mockRestore();
    expect(mfaServiceFresh.getPingOneUserContact).toHaveBeenCalledWith('5');
    expect(mfaServiceFresh.initiateOneTimeOtp).toHaveBeenCalledWith('5', 'EMAIL', 'user@example.com', 'user-token-abc');
    expect(mfaServiceFresh.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.otpSent).toBe(true);
    expect(result.maskedContact).toBe('us**@example.com');
    expect(result.mfaRequired).toBeUndefined();
    expect(req.session.txConsentChallenges[CHALLENGE_ID].oneTimePath).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].daId).toBe('da-onetime-001');
  });

  test('onetime mode ignores stepup threshold — always uses one-time OTP even for large amounts', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    mfaServiceFresh.initiateOneTimeOtp.mockResolvedValue({
      id: 'da-onetime-002',
      status: 'OTP_REQUIRED',
      _embedded: { devices: [{ type: 'EMAIL', email: 'us**@example.com' }] },
    });
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'onetime';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-large`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 9999, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-large`);
    spy.mockRestore();
    expect(mfaServiceFresh.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(mfaServiceFresh.initiateOneTimeOtp).toHaveBeenCalled();
    expect(result.otpSent).toBe(true);
  });

  test('no email or phone returns needsContact:true so UI can collect it', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.getPingOneUserContact.mockResolvedValue({ email: null, mobilePhone: null });
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'onetime';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-nocontact`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-nocontact`);
    spy.mockRestore();
    expect(result.ok).toBe(true);
    expect(result.needsContact).toBe(true);
    expect(mfaServiceFresh.initiateOneTimeOtp).not.toHaveBeenCalled();
    // challenge stays pending so confirmOnetimeContact can proceed
    expect(req.session.txConsentChallenges[`${CHALLENGE_ID}-nocontact`].status).toBe('pending');
    expect(req.session.txConsentChallenges[`${CHALLENGE_ID}-nocontact`].oneTimePath).toBe(true);
    expect(req.session.txConsentChallenges[`${CHALLENGE_ID}-nocontact`].pendingContact).toBe(true);
  });

  test('one-time init runs on a worker token — a PingOne INVALID_TOKEN is a 502, never a session_expired re-auth loop', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    // PingOne rejects with INVALID_TOKEN. Because one-time init uses a worker token
    // (not the user session token), re-login can't help — must stay a 502, not 401.
    const tokenErr = Object.assign(new Error('The request could not be completed. You do not have access to this resource.'), {
      status: 401,
      code: 'token_expired',
      pingError: { code: 'ACCESS_FAILED', details: [{ code: 'INVALID_TOKEN', target: 'Authentication' }] },
    });
    mfaServiceFresh.initiateOneTimeOtp.mockRejectedValue(tokenErr);
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'onetime';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-invalidtoken`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc', expiresAt: Date.now() + 600_000 } }});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-invalidtoken`);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.json.error).toBe('mfa_init_failed');
  });

  test('non-token MFA init failure stays a 502 retry (mfa_init_failed)', async () => {
    const { txConsentFresh, mfaServiceFresh, configStoreFresh } = freshRequires();
    mfaServiceFresh.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    // e.g. PingOne 5xx / network — no token signal.
    const otherErr = Object.assign(new Error('socket hang up'), { status: 502 });
    mfaServiceFresh.initiateOneTimeOtp.mockRejectedValue(otherErr);
    const spy = jest.spyOn(configStoreFresh, 'getEffective').mockImplementation((key) => {
      if (key === 'hitl_consent_mfa_mode') return 'onetime';
      if (key === 'confirm_stepup_threshold_usd') return '500';
      if (key === 'confirm_threshold_usd') return '250';
      return null;
    });
    const req = makeReq({ session: { txConsentChallenges: {
      [`${CHALLENGE_ID}-otherfail`]: {
        userId: '5', snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
      },
    }, oauthTokens: { accessToken: 'user-token-abc' } }});
    const result = await txConsentFresh.confirmChallenge(req, `${CHALLENGE_ID}-otherfail`);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.json.error).toBe('mfa_init_failed');
  });
});

describe('verifyMfa — one-time OTP path', () => {
  const CHALLENGE_ID = 'onetime-verify-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeReqWithOnetimeChallenge(challengeId) {
    const ch = {
      userId: '5',
      snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
      status: 'otp_pending',
      oneTimePath: true,
      daId: 'da-onetime-001',
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      otpAttempts: 0,
      otpExpiresAt: Date.now() + 300_000,
    };
    return { user: { id: '5', role: 'customer' }, session: { txConsentChallenges: { [challengeId]: ch } } };
  }

  test('verifyMfa with oneTimePath calls verifyOneTimeOtp (no deviceId needed)', async () => {
    mfaService.verifyOneTimeOtp = jest.fn().mockResolvedValue({ status: 'COMPLETED' });
    const req = makeReqWithOnetimeChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { otp: '654321' });
    expect(mfaService.verifyOneTimeOtp).toHaveBeenCalledWith('da-onetime-001', '654321');
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('confirmed');
  });

  test('demo bypass 123123 on oneTimePath promotes to confirmed without calling PingOne', async () => {
    mfaService.verifyOneTimeOtp = jest.fn();
    const req = makeReqWithOnetimeChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { otp: '123123' });
    expect(mfaService.verifyOneTimeOtp).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('confirmed');
  });

  test('missing otp on oneTimePath returns 400 missing_credential', async () => {
    mfaService.verifyOneTimeOtp = jest.fn();
    const req = makeReqWithOnetimeChallenge(CHALLENGE_ID);
    const result = await txConsent.verifyMfa(req, CHALLENGE_ID, { otp: undefined });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.json.error).toBe('missing_credential');
  });

  test('getChallengePath returns onetime for oneTimePath challenges', () => {
    const req = makeReqWithOnetimeChallenge(CHALLENGE_ID);
    expect(txConsent.getChallengePath(req, CHALLENGE_ID)).toBe('onetime');
  });

  test('verifyOtp rejects oneTimePath challenges with not_mfa_path', () => {
    const req = makeReqWithOnetimeChallenge(CHALLENGE_ID);
    const result = txConsent.verifyOtp(req, CHALLENGE_ID, '654321');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.json.error).toBe('not_mfa_path');
  });
});

describe('confirmOnetimeContact', () => {
  const CHALLENGE_ID = 'onetime-contact-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeReqWithPendingContact(challengeId) {
    const ch = {
      userId: '5',
      snapshot: { type: 'withdrawal', amount: 600, fromAccountId: 'acc1', toAccountId: null, description: '' },
      status: 'pending',
      oneTimePath: true,
      pendingContact: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    };
    return {
      user: { id: '5', role: 'customer' },
      session: { txConsentChallenges: { [challengeId]: ch }, oauthTokens: { accessToken: 'user-tok' } },
    };
  }

  test('valid email — calls initiateOneTimeOtp and transitions to otp_pending', async () => {
    mfaService.initiateOneTimeOtp = jest.fn().mockResolvedValue({
      id: 'da-contact-001',
      status: 'OTP_REQUIRED',
      _embedded: { devices: [{ type: 'EMAIL', email: 'us**@test.com' }] },
    });
    const req = makeReqWithPendingContact(CHALLENGE_ID);
    const result = await txConsent.confirmOnetimeContact(req, CHALLENGE_ID, { email: 'user@test.com' });
    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith('5', 'EMAIL', 'user@test.com', 'user-tok');
    expect(result.ok).toBe(true);
    expect(result.otpSent).toBe(true);
    expect(result.maskedContact).toBe('us**@test.com');
    expect(req.session.txConsentChallenges[CHALLENGE_ID].status).toBe('otp_pending');
    expect(req.session.txConsentChallenges[CHALLENGE_ID].daId).toBe('da-contact-001');
    expect(req.session.txConsentChallenges[CHALLENGE_ID].pendingContact).toBe(false);
  });

  test('invalid contact returns 400', async () => {
    const req = makeReqWithPendingContact(CHALLENGE_ID);
    const result = await txConsent.confirmOnetimeContact(req, CHALLENGE_ID, { email: 'not-an-email' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.json.error).toBe('invalid_contact');
  });

  test('challenge not in pendingContact state returns 409', async () => {
    const req = makeReqWithPendingContact(CHALLENGE_ID);
    req.session.txConsentChallenges[CHALLENGE_ID].pendingContact = false;
    const result = await txConsent.confirmOnetimeContact(req, CHALLENGE_ID, { email: 'a@b.com' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.json.error).toBe('contact_not_needed');
  });
});

// ── selectMfaDevice: FIDO2 status/options passthrough ────────────────────────
// Regression coverage: selectMfaDevice used to discard mfaService.selectDevice's
// response down to { ok, otpExpiresAt }, so a FIDO2 device could never be
// distinguished from an OTP one — the client had no way to know it needed to
// run a WebAuthn ceremony instead of showing a code field.

describe('selectMfaDevice', () => {
  const CHALLENGE_ID = 'select-device-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('FIDO2 device — passes status and publicKeyCredentialRequestOptions through', async () => {
    const options = { challenge: 'abc123', rpId: 'ping-devops.com' };
    mfaService.selectDevice.mockResolvedValue({
      status: 'ASSERTION_REQUIRED',
      publicKeyCredentialRequestOptions: options,
    });
    const req = makeReqWithMfaChallenge(CHALLENGE_ID, {
      challenge: { devices: [{ id: 'fido-dev-1', type: 'FIDO2' }] },
    });
    const result = await txConsent.selectMfaDevice(req, CHALLENGE_ID, 'fido-dev-1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ASSERTION_REQUIRED');
    expect(result.publicKeyCredentialRequestOptions).toEqual(options);
  });

  test('OTP device — status passed through, no publicKeyCredentialRequestOptions', async () => {
    mfaService.selectDevice.mockResolvedValue({ status: 'OTP_REQUIRED' });
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.selectMfaDevice(req, CHALLENGE_ID, 'dev-1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('OTP_REQUIRED');
    expect(result.publicKeyCredentialRequestOptions).toBeNull();
  });
});

// ── reinitMfaDevices ──────────────────────────────────────────────────────────
// Lets a device enrolled while the picker is open (typically a first passkey)
// become selectable without cancelling the transfer: confirmChallenge() only
// captures the device list once and cannot be re-run (409 on a second call).

describe('reinitMfaDevices', () => {
  const CHALLENGE_ID = 'reinit-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('refreshes daId and devices on a challenge awaiting device verification', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-fresh-002',
      _embedded: { devices: [{ id: 'dev-1', type: 'EMAIL' }, { id: 'fido-new', type: 'FIDO2' }] },
    });
    const req = makeReqWithMfaChallenge(CHALLENGE_ID);
    const result = await txConsent.reinitMfaDevices(req, CHALLENGE_ID);
    expect(result.ok).toBe(true);
    expect(result.devices).toHaveLength(2);
    expect(result.devices.some((d) => d.type === 'FIDO2')).toBe(true);
    const ch = req.session.txConsentChallenges[CHALLENGE_ID];
    expect(ch.daId).toBe('da-fresh-002');
    expect(ch.otpAttempts).toBe(0);
  });

  test('rejects a challenge that is not on the device-picker path', async () => {
    const req = makeReqWithMfaChallenge(CHALLENGE_ID, { challenge: { mfaPath: false } });
    const result = await txConsent.reinitMfaDevices(req, CHALLENGE_ID);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.json.error).toBe('challenge_not_mfa_pending');
    expect(mfaService.initiateDeviceAuth).not.toHaveBeenCalled();
  });

  test('rejects an already-confirmed challenge (cannot be used to revive one past the gate)', async () => {
    const req = makeReqWithMfaChallenge(CHALLENGE_ID, { challenge: { status: 'confirmed' } });
    const result = await txConsent.reinitMfaDevices(req, CHALLENGE_ID);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(mfaService.initiateDeviceAuth).not.toHaveBeenCalled();
  });

  test('unknown challenge returns 404', async () => {
    const req = makeReq();
    const result = await txConsent.reinitMfaDevices(req, 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});
