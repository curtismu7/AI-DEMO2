'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const pingOneClientService = require('./pingOneClientService');

const REQUEST_TIMEOUT_MS = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_SEGMENT_RE = /^[a-z0-9-]{1,128}$/i;
const ALLOWED_REGIONS = new Set(['com', 'eu', 'ca', 'asia', 'com.au']);
const VERIFY_WEB_HOSTS = new Set([
  'apps.pingone.com',
  'apps.pingone.eu',
  'apps.pingone.ca',
  'apps.pingone.asia',
  'apps.pingone.com.au',
]);
const ALLOWED_STATUSES = new Set([
  'APPROVED_MANUALLY',
  'APPROVED_NO_REQUEST',
  'FAIL',
  'INITIATED',
  'IN_PROGRESS',
  'LIVENESS',
  'NOT_REQUIRED',
  'PARTIAL',
  'PHONE',
  'REQUESTED',
  'SUCCESS',
  'VOICE_ENROLLMENT',
  'VOICE_VERIFICATION',
]);

class VerifyServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VerifyServiceError';
    this.code = code;
  }
}

function settings() {
  const environmentId = String(configStore.getEffective('pingone_environment_id') || '').trim();
  const region = String(configStore.getEffective('pingone_region') || 'com').trim();
  const policyId = String(configStore.getEffective('pingone_verify_policy_id') || '').trim();

  if (!UUID_RE.test(environmentId) || !UUID_RE.test(policyId) || !ALLOWED_REGIONS.has(region.toLowerCase())) {
    throw new VerifyServiceError('VERIFY_NOT_CONFIGURED', 'PingOne Verify is not configured');
  }
  return { environmentId, region: region.toLowerCase(), policyId };
}

function isConfigured() {
  try {
    settings();
    const authMethod = String(configStore.getEffective('pingone_mgmt_token_auth_method') || 'basic').toLowerCase();
    const needsSecret = authMethod !== 'none' && authMethod !== 'private_key_jwt';
    const { clientId, clientSecret } = pingOneClientService.resolveWorkerCredentials(needsSecret);
    if (!clientId || (needsSecret && !clientSecret)) return false;
    if (authMethod === 'private_key_jwt' && !configStore.getEffective('pingone_mgmt_private_key')) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return ALLOWED_STATUSES.has(normalized) ? normalized : 'UNKNOWN';
}

function validateRedirectUrl(redirectUrl) {
  try {
    const url = new URL(String(redirectUrl || ''));
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error('invalid');
    return url.toString();
  } catch {
    throw new VerifyServiceError('VERIFY_INVALID_REDIRECT', 'PingOne Verify redirect URL is invalid');
  }
}

function validateTransactionId(value) {
  const id = String(value || '').trim();
  if (!PATH_SEGMENT_RE.test(id)) throw new VerifyServiceError('VERIFY_INVALID_TRANSACTION', 'PingOne Verify transaction is invalid');
  return id;
}

function transactionUrl({ environmentId, region }, pingOneUserId, transactionId) {
  if (!UUID_RE.test(String(pingOneUserId || ''))) {
    throw new VerifyServiceError('VERIFY_INVALID_USER', 'PingOne user identifier is invalid');
  }
  const base = `https://api.pingone.${region}`;
  const prefix = `${base}/v1/environments/${encodeURIComponent(environmentId)}/users/${encodeURIComponent(pingOneUserId)}/verifyTransactions`;
  return transactionId ? `${prefix}/${encodeURIComponent(validateTransactionId(transactionId))}` : prefix;
}

function validExpiry(expiresAt) {
  return typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt));
}

function isExpectedUserRelation(data, { environmentId, region }, expectedUserId) {
  let foundBinding = false;
  if (data?.user?.id !== undefined) {
    foundBinding = true;
    if (String(data.user.id) !== expectedUserId) return false;
  }
  const href = data?._links?.user?.href;
  if (href !== undefined) {
    foundBinding = true;
    try {
      const relation = new URL(String(href));
      const expectedOrigin = `https://api.pingone.${region}`;
      const expectedPath = `/v1/environments/${environmentId}/users/${expectedUserId}`;
      if (relation.origin !== expectedOrigin || relation.pathname !== expectedPath || relation.search || relation.hash) return false;
    } catch {
      return false;
    }
  }
  return foundBinding;
}

function parseTransaction(data, { cfg, expectedId, expectedUserId, requireWebUrl = false } = {}) {
  const id = String(data?.id || '').trim();
  const status = normalizeStatus(data?.transactionStatus?.status);
  const expiresAt = data?.expiresAt;
  const webVerificationUrl = data?.webVerificationUrl;
  let webUrl;
  if (requireWebUrl) {
    try {
      webUrl = new URL(String(webVerificationUrl || ''));
      if (webUrl.protocol !== 'https:' || webUrl.username || webUrl.password || (webUrl.port && webUrl.port !== '443') || !VERIFY_WEB_HOSTS.has(webUrl.hostname.toLowerCase())) throw new Error('invalid');
    } catch {
      throw new VerifyServiceError('VERIFY_INVALID_PROVIDER_RESPONSE', 'PingOne Verify returned an invalid handoff URL');
    }
  }
  if (!PATH_SEGMENT_RE.test(id) || (expectedId && id !== expectedId) || !isExpectedUserRelation(data, cfg, expectedUserId) || !validExpiry(expiresAt)) {
    throw new VerifyServiceError('VERIFY_INVALID_PROVIDER_RESPONSE', 'PingOne Verify returned an invalid transaction');
  }
  return {
    id,
    ...(requireWebUrl ? { webVerificationUrl: webUrl.toString() } : {}),
    expiresAt,
    status,
  };
}

async function managementHeaders() {
  const token = await pingOneClientService.getManagementToken();
  if (!token) throw new VerifyServiceError('VERIFY_NOT_CONFIGURED', 'PingOne Verify is not configured');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function createTransaction({ pingOneUserId, redirectUrl }) {
  const cfg = settings();
  const safeRedirectUrl = validateRedirectUrl(redirectUrl);
  const url = transactionUrl(cfg, pingOneUserId);
  const headers = await managementHeaders();
  const { data } = await axios.post(url, {
    verifyPolicy: { id: cfg.policyId },
    redirect: { url: safeRedirectUrl },
  }, { headers, timeout: REQUEST_TIMEOUT_MS });
  return parseTransaction(data, { cfg, expectedUserId: pingOneUserId, requireWebUrl: true });
}

async function readTransaction({ pingOneUserId, transactionId }) {
  const cfg = settings();
  const id = validateTransactionId(transactionId);
  const url = transactionUrl(cfg, pingOneUserId, id);
  const headers = await managementHeaders();
  const { data } = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
  return parseTransaction(data, { cfg, expectedId: id, expectedUserId: pingOneUserId });
}

module.exports = {
  createTransaction,
  readTransaction,
  isConfigured,
  normalizeStatus,
  VerifyServiceError,
  REQUEST_TIMEOUT_MS,
};
