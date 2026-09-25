'use strict';

jest.mock('../../services/mfaService', () => ({
  submitOtp: jest.fn(),
}));

const mfaService = require('../../services/mfaService');
const { verifyMfa } = require('../../services/transactionConsentChallenge');

describe('transaction consent MFA OTP verification', () => {
  const challengeId = 'hitl-otp-test';

  function reqWithPendingMfa() {
    return {
      user: { id: 'u1' },
      session: {
        oauthTokens: { accessToken: 'user-access-token' },
        txConsentChallenges: {
          [challengeId]: {
            userId: 'u1',
            status: 'otp_pending',
            mfaPath: true,
            daId: 'da-123',
            otpExpiresAt: Date.now() + 60_000,
          },
        },
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mfaService.submitOtp.mockResolvedValue({ status: 'COMPLETED' });
  });

  test.each([
    ['email', 'email-device'],
    ['SMS', 'sms-device'],
  ])('%s real OTP is verified against the selected PingOne device', async (_channel, deviceId) => {
    const req = reqWithPendingMfa();

    const result = await verifyMfa(req, challengeId, { deviceId, otp: '654321' });

    expect(result.ok).toBe(true);
    expect(mfaService.submitOtp).toHaveBeenCalledWith(
      'da-123',
      deviceId,
      '654321',
      'user-access-token',
    );
  });

  test.each([
    ['email', 'email-device'],
    ['SMS', 'sms-device'],
  ])('%s demo code 123123 remains accepted', async (_channel, deviceId) => {
    const req = reqWithPendingMfa();

    const result = await verifyMfa(req, challengeId, { deviceId, otp: '123123' });

    expect(result.ok).toBe(true);
    expect(mfaService.submitOtp).not.toHaveBeenCalled();
  });
});
