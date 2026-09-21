'use strict';

const {
  createHostedRegistrationService,
  normalizeRegistrationEmail,
} = require('../../services/hostedRegistrationService');

function store() {
  const records = new Map();
  return {
    get: (id) => records.get(id) || null,
    put: (record) => records.set(record.id, { ...record }),
    list: () => [...records.values()],
    records,
  };
}

describe('hostedRegistrationService', () => {
  test('accepts only exact pingidentity.com addresses', () => {
    expect(normalizeRegistrationEmail(' Alice@PingIdentity.com ')).toBe('alice@pingidentity.com');
    expect(() => normalizeRegistrationEmail('alice@pingone.com')).toThrow('pingidentity.com');
    expect(() => normalizeRegistrationEmail('alice@evilpingidentity.com')).toThrow('pingidentity.com');
  });

  test('creates a pending OTP request without storing the plaintext code', async () => {
    const backing = store();
    const sent = [];
    const service = createHostedRegistrationService({
      store: backing,
      now: () => 1000,
      generateOtp: () => '123456',
      sendOtp: async (email, otp) => sent.push({ email, otp }),
    });

    const result = await service.request({ email: 'alice@pingidentity.com', firstName: 'Alice' });
    const saved = backing.get(result.requestId);
    expect(result.status).toBe('otp_pending');
    expect(sent).toEqual([{ email: 'alice@pingidentity.com', otp: '123456' }]);
    expect(saved.otpHash).not.toBe('123456');
    expect(saved.otp).toBeUndefined();
    expect(saved.status).toBe('otp_pending');
  });

  test('verifies a single-use OTP and transitions to pending approval', async () => {
    const backing = store();
    const service = createHostedRegistrationService({
      store: backing,
      now: () => 1000,
      generateOtp: () => '123456',
      sendOtp: async () => {},
    });
    const created = await service.request({ email: 'alice@pingidentity.com' });

    expect(await service.verify(created.requestId, '123456')).toMatchObject({ status: 'pending_approval' });
    expect(backing.get(created.requestId).otpHash).toBeNull();
    expect(await service.verify(created.requestId, '123456')).toMatchObject({ error: 'invalid_request_state' });
  });

  test('expires OTPs and locks after five incorrect attempts', async () => {
    const backing = store();
    let now = 1000;
    const service = createHostedRegistrationService({
      store: backing,
      now: () => now,
      generateOtp: () => '123456',
      sendOtp: async () => {},
      otpTtlMs: 100,
    });
    const created = await service.request({ email: 'alice@pingidentity.com' });
    for (let i = 0; i < 4; i += 1) {
      expect((await service.verify(created.requestId, '000000')).error).toBe('invalid_otp');
    }
    expect((await service.verify(created.requestId, '000000')).error).toBe('otp_locked');
    expect((await service.verify(created.requestId, '123456')).error).toBe('otp_locked');

    const second = await service.request({ email: 'bob@pingidentity.com' });
    now = 1101;
    expect((await service.verify(second.requestId, '123456')).error).toBe('otp_expired');
  });

  test('resubmitting the same email returns the existing nonterminal request', async () => {
    const backing = store();
    let sent = 0;
    const service = createHostedRegistrationService({
      store: backing,
      now: () => 1000,
      generateOtp: () => '123456',
      sendOtp: async () => { sent += 1; },
    });
    const first = await service.request({ email: 'alice@pingidentity.com' });
    const second = await service.request({ email: 'ALICE@PINGIDENTITY.COM' });
    expect(second.requestId).toBe(first.requestId);
    expect(sent).toBe(1);
  });
});
