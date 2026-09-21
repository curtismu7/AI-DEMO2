'use strict';

const crypto = require('crypto');
const defaultStore = require('./lmdb/hostedRegistrationStore.lmdb');
const { initiateOneTimeOtp, verifyOneTimeOtp } = require('./mfaService');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@pingidentity\.com$/i;

function normalizeRegistrationEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('Only pingidentity.com email addresses are accepted');
  return email;
}

function publicRecord(record) {
  if (!record) return null;
  const { otpExpiresAt, otpAttempts, statusTokenHash, pingOneMfaId, ...safe } = record;
  return safe;
}

function createHostedRegistrationService({
  store = defaultStore,
  now = Date.now,
  generateId = () => crypto.randomBytes(18).toString('hex'),
  startMfa = (record) => initiateOneTimeOtp(record.pingOneUserId, 'EMAIL', record.email),
  verifyMfa = (record, otp) => verifyOneTimeOtp(record.pingOneMfaId, otp),
  otpTtlMs = OTP_TTL_MS,
  otpResendCooldownMs = OTP_RESEND_COOLDOWN_MS,
  stageRegistration = null,
} = {}) {
  function findByEmail(email) {
    return store.list().find((record) => record.email === email && !['rejected', 'expired'].includes(record.status));
  }

  async function request(input = {}) {
    const email = normalizeRegistrationEmail(input.email);
    const existing = findByEmail(email);
    if (existing && existing.status !== 'otp_pending') {
      return { requestId: existing.id, status: existing.status, email };
    }
    if (existing && existing.lastOtpSentAt && now() - existing.lastOtpSentAt < otpResendCooldownMs) {
      return { requestId: existing.id, status: existing.status, email };
    }
    const record = existing || {
      id: generateId(),
      email,
      firstName: String(input.firstName || '').trim().slice(0, 80),
      lastName: String(input.lastName || '').trim().slice(0, 80),
      requestedRole: String(input.requestedRole || 'user').trim().toLowerCase(),
      status: 'otp_pending',
      createdAt: now(),
      updatedAt: now(),
      verifiedAt: null,
      approvedAt: null,
      rejectedAt: null,
      disabledAt: null,
      pingOneUserId: null,
      groups: [],
    };
    record.status = record.status === 'pending_approval' ? record.status : 'otp_pending';
    record.otpExpiresAt = now() + otpTtlMs;
    record.otpAttempts = 0;
    record.lastOtpSentAt = now();
    record.updatedAt = now();
    store.put(record);
    if (stageRegistration && !record.pingOneUserId) {
      const staged = await stageRegistration(record);
      Object.assign(record, staged);
      store.put(record);
    }
    const mfaChallenge = await startMfa(record);
    if (!mfaChallenge?.id) {
      throw Object.assign(new Error('PingOne MFA did not return a device authentication ID'), {
        code: 'registration_mfa_unconfigured',
      });
    }
    record.pingOneMfaId = mfaChallenge.id;
    record.updatedAt = now();
    store.put(record);
    return { requestId: record.id, status: record.status, email }; 
  }

  async function verify(requestId, suppliedOtp) {
    const record = store.get(requestId);
    if (!record) return { error: 'request_not_found' };
    if (record.status !== 'otp_pending') return { error: 'invalid_request_state', status: record.status };
    if (record.otpAttempts >= MAX_OTP_ATTEMPTS) return { error: 'otp_locked' };
    if (!record.otpExpiresAt || now() > record.otpExpiresAt) {
      record.status = 'expired';
      record.updatedAt = now();
      store.put(record);
      return { error: 'otp_expired' };
    }
    let mfaResult;
    try {
      mfaResult = await verifyMfa(record, suppliedOtp);
    } catch (error) {
      record.otpAttempts += 1;
      store.put(record);
      if (error.status && error.status < 500) {
        return { error: record.otpAttempts >= MAX_OTP_ATTEMPTS ? 'otp_locked' : 'invalid_otp' };
      }
      throw error;
    }
    if (mfaResult?.status !== 'COMPLETED') {
      record.otpAttempts += 1;
      store.put(record);
      return { error: record.otpAttempts >= MAX_OTP_ATTEMPTS ? 'otp_locked' : 'invalid_otp' };
    }
    record.status = 'pending_approval';
    record.verifiedAt = now();
    record.updatedAt = now();
    record.otpExpiresAt = null;
    record.otpAttempts = 0;
    store.put(record);
    return publicRecord(record);
  }

  return {
    request,
    verify,
    get: (id) => publicRecord(store.get(id)),
    update: (id, patch = {}) => {
      const record = store.get(id);
      if (!record) return null;
      const updated = { ...record, ...patch, updatedAt: now() };
      store.put(updated);
      return publicRecord(updated);
    },
    list: () => store.list().map(publicRecord),
  };
}

module.exports = {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  MAX_OTP_ATTEMPTS,
  normalizeRegistrationEmail,
  createHostedRegistrationService,
};
