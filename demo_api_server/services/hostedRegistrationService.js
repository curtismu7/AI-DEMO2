'use strict';

const crypto = require('crypto');
const defaultStore = require('./lmdb/hostedRegistrationStore.lmdb');
const { sendHostedRegistrationOtp } = require('./emailService');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@pingidentity\.com$/i;

function normalizeRegistrationEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('Only pingidentity.com email addresses are accepted');
  return email;
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function publicRecord(record) {
  if (!record) return null;
  const { otpHash, otpExpiresAt, otpAttempts, statusTokenHash, ...safe } = record;
  return safe;
}

function createHostedRegistrationService({
  store = defaultStore,
  now = Date.now,
  generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
  generateId = () => crypto.randomBytes(18).toString('hex'),
  sendOtp = sendHostedRegistrationOtp,
  otpTtlMs = OTP_TTL_MS,
  otpResendCooldownMs = OTP_RESEND_COOLDOWN_MS,
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
    const otp = generateOtp();
    record.status = record.status === 'pending_approval' ? record.status : 'otp_pending';
    record.otpHash = hashOtp(otp);
    record.otpExpiresAt = now() + otpTtlMs;
    record.otpAttempts = 0;
    record.lastOtpSentAt = now();
    record.updatedAt = now();
    store.put(record);
    await sendOtp(email, otp);
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
    record.otpAttempts += 1;
    if (hashOtp(suppliedOtp) !== record.otpHash) {
      store.put(record);
      return { error: record.otpAttempts >= MAX_OTP_ATTEMPTS ? 'otp_locked' : 'invalid_otp' };
    }
    record.status = 'pending_approval';
    record.verifiedAt = now();
    record.updatedAt = now();
    record.otpHash = null;
    record.otpExpiresAt = null;
    record.otpAttempts = 0;
    store.put(record);
    return publicRecord(record);
  }

  return { request, verify, get: (id) => publicRecord(store.get(id)), list: () => store.list().map(publicRecord) };
}

module.exports = {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  MAX_OTP_ATTEMPTS,
  normalizeRegistrationEmail,
  createHostedRegistrationService,
  hashOtp,
};
