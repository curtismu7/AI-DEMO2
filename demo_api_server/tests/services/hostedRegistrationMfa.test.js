'use strict';

jest.mock('../../services/mfaService', () => ({
  initiateOneTimeOtp: jest.fn(),
  verifyOneTimeOtp: jest.fn(),
}));

const mfaService = require('../../services/mfaService');
const { createHostedRegistrationService } = require('../../services/hostedRegistrationService');

function makeStore() {
  const records = new Map();
  return {
    get: (id) => records.get(id) || null,
    put: (record) => records.set(record.id, { ...record }),
    list: () => [...records.values()],
  };
}

describe('hosted registration PingOne MFA OTP', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts a PingOne email OTP for the staged registration user', async () => {
    mfaService.initiateOneTimeOtp.mockResolvedValue({ id: 'da-123', status: 'OTP_REQUIRED' });
    const store = makeStore();
    const service = createHostedRegistrationService({
      store,
      generateId: () => 'req-123',
      stageRegistration: async () => ({ pingOneUserId: 'user-123', groups: ['partial'] }),
    });

    await service.request({ email: 'new.user@pingidentity.com', phone: '+14155550123' });

    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith(
      'user-123',
      'EMAIL',
      'new.user@pingidentity.com',
      undefined,
      { templateVariant: 'ai-demo-hosted-registration' },
    );
    expect(store.get('req-123')).toEqual(expect.objectContaining({
      pingOneMfaId: 'da-123',
      pingOneUserId: 'user-123',
    }));
  });

  it('accepts registration verification only when PingOne MFA completes', async () => {
    mfaService.initiateOneTimeOtp.mockResolvedValue({ id: 'da-123', status: 'OTP_REQUIRED' });
    mfaService.verifyOneTimeOtp.mockResolvedValue({ id: 'da-123', status: 'COMPLETED' });
    const service = createHostedRegistrationService({
      store: makeStore(),
      generateId: () => 'req-123',
      stageRegistration: async () => ({ pingOneUserId: 'user-123', groups: ['partial'] }),
    });

    await service.request({ email: 'new.user@pingidentity.com', phone: '+14155550123' });
    const result = await service.verify('req-123', '654321');

    expect(mfaService.verifyOneTimeOtp).toHaveBeenCalledWith('da-123', '654321');
    expect(result).toEqual(expect.objectContaining({ status: 'pending_approval' }));
  });
});
