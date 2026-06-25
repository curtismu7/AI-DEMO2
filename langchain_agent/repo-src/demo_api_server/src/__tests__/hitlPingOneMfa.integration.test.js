/**
 * hitlPingOneMfa.integration.test.js
 * Integration tests for the PingOne MFA HITL consent challenge flow.
 *
 * Uses REAL configStore from .env (not mocked) — spied on only for the three
 * feature-flag keys this flow depends on.  Mocks only mfaService and data/store
 * to avoid network calls and database side-effects.
 *
 * Tests the full sequence: create → confirm (gets devices) → select-device
 * → verify-otp → consume.
 *
 * Service layer only — no HTTP / supertest needed.
 */
'use strict';

// Mock mfaService — all external PingOne calls go through here.
jest.mock('../../services/mfaService', () => ({
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
}));

// Mock data store to avoid touching real database.
jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    const accounts = {
      'acc1': { id: 'acc1', userId: 'user-integ', balance: 10000 },
      'acc2': { id: 'acc2', userId: 'user-integ', balance: 5000 },
    };
    return accounts[id] || null;
  }),
  getAccountsByUserId: jest.fn(() => [
    { id: 'acc1', userId: 'user-integ', balance: 10000 },
    { id: 'acc2', userId: 'user-integ', balance: 5000 },
  ]),
  getUserById: jest.fn(() => null),
}));

// configStore is NOT mocked — uses real .env.  We spy per-test/describe to
// override only the three feature-flag keys this flow depends on.
const configStore = require('../../services/configStore');
const txConsent = require('../../services/transactionConsentChallenge');
const mfaService = require('../../services/mfaService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express-like request object.
 * Default: customer user, empty challenges, a user access token in oauthTokens.
 */
function makeReq(overrides = {}) {
  return {
    user: { id: 'user-integ', role: 'customer', ...overrides.user },
    session: {
      txConsentChallenges: {},
      oauthTokens: { accessToken: 'integ-user-token' },
      ...(overrides.session || {}),
    },
  };
}

/**
 * Spy on configStore.getEffective so that the three MFA feature-flag keys
 * return test values; all other keys fall through to the real implementation.
 * Returns the spy so the caller can restore it in afterEach / after block.
 */
function spyMfaFlags(realGetEffective) {
  return jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
    if (key === 'ff_hitl_pingone_mfa_enabled') return 'true';
    if (key === 'confirm_stepup_threshold_usd') return '500';
    if (key === 'confirm_threshold_usd') return '250';
    if (key === 'hitl_consent_mfa_mode') return 'device_picker';
    return realGetEffective(key);
  });
}

// ---------------------------------------------------------------------------
// Suite: PingOne MFA HITL — full flow (flag on)
// ---------------------------------------------------------------------------

describe('PingOne MFA HITL — full flow (flag on)', () => {
  // Capture the real getEffective before any spy is installed so we can
  // delegate unknown keys back to it.
  const realGetEffective = configStore.getEffective.bind(configStore);
  let cfgSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    cfgSpy = spyMfaFlags(realGetEffective);
  });

  afterEach(() => {
    cfgSpy.mockRestore();
  });

  // ── Test 1: create → confirm returns mfaRequired + devices ───────────────

  test('Test 1: create returns ok + confirm returns mfaRequired with devices list', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-integ-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: {
        devices: [
          { id: 'dev-email-1', type: 'EMAIL', email: 'u@example.com' },
          { id: 'dev-sms-1',   type: 'SMS',   phone: '+15551234567' },
        ],
      },
    });

    const req = makeReq();

    // Step 1: create challenge (amount 600 > 250 threshold)
    const created = txConsent.createChallenge(req, {
      type: 'withdrawal',
      amount: 600,
      fromAccountId: 'acc1',
      description: 'Test',
    });
    expect(created.ok).toBe(true);
    expect(created.challengeId).toBeDefined();

    const { challengeId } = created;

    // Step 2: confirm → should trigger PingOne MFA (amount 600 >= 500 step-up threshold)
    const confirmed = await txConsent.confirmChallenge(req, challengeId);

    expect(confirmed.ok).toBe(true);
    expect(confirmed.mfaRequired).toBe(true);
    expect(confirmed.devices).toHaveLength(2);
    expect(confirmed.devices[0].type).toBe('EMAIL');

    expect(mfaService.initiateDeviceAuth).toHaveBeenCalledWith('user-integ', 'integ-user-token');

    const ch = req.session.txConsentChallenges[challengeId];
    expect(ch.daId).toBe('da-integ-001');
    expect(ch.mfaPath).toBe(true);
  });

  // ── Test 2: select-device triggers PingOne and refreshes otpExpiresAt ────

  test('Test 2: select-device calls mfaService.selectDevice and refreshes otpExpiresAt', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-integ-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: {
        devices: [
          { id: 'dev-email-1', type: 'EMAIL', email: 'u@example.com' },
          { id: 'dev-sms-1',   type: 'SMS',   phone: '+15551234567' },
        ],
      },
    });
    mfaService.selectDevice.mockResolvedValue({ id: 'da-integ-001', status: 'OTP_REQUIRED' });

    const req = makeReq();

    // create + confirm first
    const created = txConsent.createChallenge(req, {
      type: 'withdrawal', amount: 600, fromAccountId: 'acc1', description: 'Test',
    });
    const { challengeId } = created;
    await txConsent.confirmChallenge(req, challengeId);

    const originalExpiry = req.session.txConsentChallenges[challengeId].otpExpiresAt;

    // select device
    const selected = await txConsent.selectMfaDevice(req, challengeId, 'dev-email-1');

    expect(selected.ok).toBe(true);
    expect(mfaService.selectDevice).toHaveBeenCalledWith('da-integ-001', 'dev-email-1', 'integ-user-token');
    expect(selected.otpExpiresAt).toBeGreaterThan(Date.now());

    // otpExpiresAt should be refreshed (>= original — allow equality for fast runners)
    expect(req.session.txConsentChallenges[challengeId].otpExpiresAt).toBeGreaterThanOrEqual(originalExpiry);
  });

  // ── Test 3: verify-otp with PingOne OTP promotes to confirmed ─────────────

  test('Test 3: verifyMfa submits OTP to PingOne and promotes challenge to confirmed', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-integ-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: { devices: [{ id: 'dev-email-1', type: 'EMAIL', email: 'u@example.com' }] },
    });
    mfaService.selectDevice.mockResolvedValue({ id: 'da-integ-001', status: 'OTP_REQUIRED' });
    mfaService.submitOtp.mockResolvedValue({ id: 'da-integ-001', status: 'COMPLETED' });

    const req = makeReq();

    const created = txConsent.createChallenge(req, {
      type: 'withdrawal', amount: 600, fromAccountId: 'acc1', description: 'Test',
    });
    const { challengeId } = created;
    await txConsent.confirmChallenge(req, challengeId);
    await txConsent.selectMfaDevice(req, challengeId, 'dev-email-1');

    // verify OTP
    const verified = await txConsent.verifyMfa(
      req,
      challengeId,
      { deviceId: 'dev-email-1', otp: '654321' },
      'https://api.ping.demo:4000',
    );

    expect(verified.ok).toBe(true);
    expect(mfaService.submitOtp).toHaveBeenCalledWith('da-integ-001', 'dev-email-1', '654321', 'integ-user-token');

    const ch = req.session.txConsentChallenges[challengeId];
    expect(ch.status).toBe('confirmed');
    expect(ch.confirmExpiresAt).toBeDefined();
  });

  // ── Test 4: verifyAndConsumeChallenge succeeds after MFA verified ─────────

  test('Test 4: verifyAndConsumeChallenge succeeds and removes challenge from session', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-integ-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: { devices: [{ id: 'dev-email-1', type: 'EMAIL', email: 'u@example.com' }] },
    });
    mfaService.selectDevice.mockResolvedValue({ id: 'da-integ-001', status: 'OTP_REQUIRED' });
    mfaService.submitOtp.mockResolvedValue({ id: 'da-integ-001', status: 'COMPLETED' });

    const req = makeReq();

    const created = txConsent.createChallenge(req, {
      type: 'withdrawal', amount: 600, fromAccountId: 'acc1', description: 'Test',
    });
    const { challengeId } = created;
    await txConsent.confirmChallenge(req, challengeId);
    await txConsent.selectMfaDevice(req, challengeId, 'dev-email-1');
    await txConsent.verifyMfa(req, challengeId, { deviceId: 'dev-email-1', otp: '654321' });

    // consume
    const consumed = txConsent.verifyAndConsumeChallenge(req, challengeId, {
      type: 'withdrawal',
      amount: 600,
      fromAccountId: 'acc1',
      toAccountId: null,
      description: 'Test',
    });

    expect(consumed.ok).toBe(true);
    expect(req.session.txConsentChallenges[challengeId]).toBeUndefined();
  });

  // ── Test 5: demo bypass 123123 works on PingOne MFA path ─────────────────

  test('Test 5: demo bypass OTP 123123 skips PingOne call and promotes to confirmed', async () => {
    mfaService.initiateDeviceAuth.mockResolvedValue({
      id: 'da-integ-001',
      status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: { devices: [{ id: 'dev-email-1', type: 'EMAIL', email: 'u@example.com' }] },
    });

    const req = makeReq();

    const created = txConsent.createChallenge(req, {
      type: 'withdrawal', amount: 600, fromAccountId: 'acc1', description: 'Test',
    });
    const { challengeId } = created;
    await txConsent.confirmChallenge(req, challengeId);

    const verified = await txConsent.verifyMfa(
      req,
      challengeId,
      { deviceId: 'dev-email-1', otp: '123123' },
      'https://api.ping.demo:4000',
    );

    expect(mfaService.submitOtp).not.toHaveBeenCalled();
    expect(verified.ok).toBe(true);
    expect(req.session.txConsentChallenges[challengeId].status).toBe('confirmed');
  });

  // ── Test 6: flag on but amount < 500 → homegrown OTP path ────────────────

  test('Test 6: amount below step-up threshold takes homegrown OTP path, not PingOne MFA', async () => {
    const req = makeReq();

    // amount 300 > 250 (confirm_threshold_usd) but < 500 (confirm_stepup_threshold_usd)
    const created = txConsent.createChallenge(req, {
      type: 'withdrawal', amount: 300, fromAccountId: 'acc1', description: 'Test',
    });
    expect(created.ok).toBe(true);
    const { challengeId } = created;

    const result = await txConsent.confirmChallenge(req, challengeId);

    expect(mfaService.initiateDeviceAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    // homegrown path does NOT set mfaRequired
    expect(result.mfaRequired).toBeFalsy();
    // homegrown path sets otpSent (true) or returns otpCodeFallback (when email is unconfigured)
    // Either way, the response is ok and mfaRequired is absent/false
    expect(result.challengeId).toBe(challengeId);
  });
});
