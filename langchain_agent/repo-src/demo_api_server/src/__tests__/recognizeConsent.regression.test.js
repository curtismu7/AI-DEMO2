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
    status: 'OTP_REQUIRED',
    _embedded: { devices: [{ type: 'EMAIL', email: 'u***@example.com' }] },
  }),
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
  verifyOneTimeOtp: jest.fn(),
}));

jest.mock('../../services/recognizeService', () => ({
  initiateSession: jest.fn().mockResolvedValue({ sessionToken: 'tok-abc', sessionId: 'sid-1' }),
  verifySession: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    const accounts = {
      'acc-1': { id: 'acc-1', userId: 'user-123', balance: 50000 },
      'acc-2': { id: 'acc-2', userId: 'user-123', balance: 10000 },
    };
    return accounts[id] || null;
  }),
  getAccountsByUserId: jest.fn(() => [
    { id: 'acc-1', userId: 'user-123', balance: 50000 },
    { id: 'acc-2', userId: 'user-123', balance: 10000 },
  ]),
  getUserById: jest.fn().mockReturnValue({ firstName: 'Test', lastName: 'User' }),
}));

const txConsent = require('../../services/transactionConsentChallenge');
const recognizeService = require('../../services/recognizeService');
const mfaService = require('../../services/mfaService');

function makeReq(sessionOverrides = {}) {
  return {
    session: {
      txConsentChallenges: {},
      oauthTokens: { accessToken: 'user-token' },
      ...sessionOverrides,
    },
    user: { id: 'user-123', username: 'testuser', role: 'customer' },
  };
}

function setupPendingChallenge(req) {
  const result = txConsent.createChallenge(req, {
    amount: 600,
    type: 'transfer',
    fromAccountId: 'acc-1',
    toAccountId: 'acc-2',
    description: 'Test transfer',
  });
  expect(result.ok).toBe(true);
  return result.challengeId;
}

describe('confirmChallenge — recognize mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    recognizeService.initiateSession.mockResolvedValue({ sessionToken: 'tok-abc', sessionId: 'sid-1' });
    recognizeService.verifySession.mockResolvedValue(true);
    mfaService.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    mfaService.initiateOneTimeOtp.mockResolvedValue({
      id: 'otp-da-id',
      status: 'OTP_REQUIRED',
      _embedded: { devices: [{ type: 'EMAIL', email: 'u***@example.com' }] },
    });
  });

  test('calls recognizeService.initiateSession, sets recognizePath+recognizeSessionId+status on challenge, returns mode:recognize with sessionToken and sessionId', async () => {
    const req = makeReq();
    const challengeId = setupPendingChallenge(req);

    const result = await txConsent.confirmChallenge(req, challengeId);

    expect(recognizeService.initiateSession).toHaveBeenCalledWith('user-123');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('recognize');
    expect(result.sessionToken).toBe('tok-abc');
    expect(result.sessionId).toBe('sid-1');

    const ch = req.session.txConsentChallenges[challengeId];
    expect(ch.recognizePath).toBe(true);
    expect(ch.recognizeSessionId).toBe('sid-1');
    expect(ch.status).toBe('recognize_pending');
  });

  test('falls back to one-time OTP when recognizeService.initiateSession throws, returns mode:onetime_fallback with otpSent:true', async () => {
    recognizeService.initiateSession.mockRejectedValueOnce(new Error('Recognize unavailable'));

    const req = makeReq();
    const challengeId = setupPendingChallenge(req);

    const result = await txConsent.confirmChallenge(req, challengeId);

    expect(recognizeService.initiateSession).toHaveBeenCalled();
    expect(mfaService.getPingOneUserContact).toHaveBeenCalledWith('user-123');
    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('onetime_fallback');
    expect(result.otpSent).toBe(true);
  });
});

describe('verifyRecognize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recognizeService.verifySession.mockResolvedValue(true);
  });

  test('sets challenge status to confirmed and returns ok:true when verifySession returns true', async () => {
    const req = makeReq();
    const challengeId = setupPendingChallenge(req);

    // put challenge into recognize_pending state
    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';
    ch.otpExpiresAt = Date.now() + 300_000;

    const result = await txConsent.verifyRecognize(req, challengeId, { sessionId: 'sid-1' });

    expect(result.ok).toBe(true);
    expect(req.session.txConsentChallenges[challengeId].status).toBe('confirmed');
  });

  test('returns ok:false, status:401, fallback:true when verifySession returns false', async () => {
    recognizeService.verifySession.mockResolvedValueOnce(false);

    const req = makeReq();
    const challengeId = setupPendingChallenge(req);

    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';
    ch.otpExpiresAt = Date.now() + 300_000;

    const result = await txConsent.verifyRecognize(req, challengeId, { sessionId: 'sid-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.fallback).toBe(true);
  });
});

describe('recognizeFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mfaService.getPingOneUserContact.mockResolvedValue({ email: 'user@example.com', mobilePhone: null });
    mfaService.initiateOneTimeOtp.mockResolvedValue({
      id: 'otp-da-id',
      status: 'OTP_REQUIRED',
      _embedded: { devices: [{ type: 'EMAIL', email: 'u***@example.com' }] },
    });
  });

  test('resets recognize_pending challenge and calls initiateOneTimeOtp, returns mode:onetime_fallback with otpSent:true', async () => {
    const req = makeReq();
    const challengeId = setupPendingChallenge(req);

    const ch = req.session.txConsentChallenges[challengeId];
    ch.status = 'recognize_pending';
    ch.recognizePath = true;
    ch.recognizeSessionId = 'sid-1';

    const result = await txConsent.recognizeFallback(req, challengeId);

    expect(mfaService.getPingOneUserContact).toHaveBeenCalledWith('user-123');
    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('onetime_fallback');
    expect(result.otpSent).toBe(true);
  });

  test('returns 409 challenge_not_pending when challenge is not in recognize_pending state', async () => {
    const req = makeReq();
    const challengeId = setupPendingChallenge(req);
    // challenge is still in 'pending' state — not recognize_pending

    const result = await txConsent.recognizeFallback(req, challengeId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
  });
});
