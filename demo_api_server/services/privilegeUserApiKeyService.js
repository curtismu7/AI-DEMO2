'use strict';

const crypto = require('crypto');
const { redactCompactJwts, containsCompactJwt } = require('../utils/redactCompactJwt');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = 'https://privilege.test-one-pingone.com';
function redactFlowData(value, secrets) {
  if (Array.isArray(value)) return value.map(item => redactFlowData(item, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !containsCompactJwt(key) && !secrets.some(secret => secret && key.includes(secret)))
      .map(([key, item]) => {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        const sensitiveName = /^(apikey|apisecret|jwt|authorization|accesstoken|refreshtoken|idtoken|token|password|currentpassword|encreqdata|encresdata|encrypteddata|encryptedpayload|ciphertext)$/.test(normalized);
        return [key, sensitiveName ? '[REDACTED]' : redactFlowData(item, secrets)];
      }));
  }
  if (typeof value === 'string') {
    let redacted = value;
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length) redacted = redacted.split(secret).join('[REDACTED]');
    }
    return redactCompactJwts(redacted).replace(/\bBearer\s+\S+/gi, '[REDACTED]');
  }
  return value;
}

class FlowError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function failure(code, message) {
  return new FlowError(code, message);
}

function validateCredentials({ environmentId, userId, apiKey, apiSecret }) {
  if (typeof environmentId !== 'string' || !UUID.test(environmentId)) {
    throw failure('INVALID_ENVIRONMENT_ID', 'Environment ID must be a UUID');
  }
  if (typeof userId !== 'string' || !UUID.test(userId)) {
    throw failure('INVALID_USER_ID', 'User ID must be a UUID');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof apiSecret !== 'string' || !apiSecret.trim()) {
    throw failure('CREDENTIALS_REQUIRED', 'Privilege user API key and secret are required');
  }
}

function deriveMaterial(apiSecret, salt) {
  return crypto.pbkdf2Sync(apiSecret, salt, 10000, 48, 'sha256');
}

function encryptAppUserTokenRequest({ environmentId, userId, apiKey, apiSecret, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  validateCredentials({ environmentId, userId, apiKey, apiSecret });
  try {
    const nonceBytes = randomBytes(32);
    const salt = randomBytes(8);
    if (!Buffer.isBuffer(nonceBytes) || nonceBytes.length !== 32 || !Buffer.isBuffer(salt) || salt.length !== 8) throw new Error();
    const nonce = nonceBytes.toString('hex');
    // Go's time.RFC3339 sample uses whole seconds rather than milliseconds.
    const timestamp = new Date(typeof now === 'function' ? now() : now).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const material = deriveMaterial(apiSecret, salt);
    const cipher = crypto.createCipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32, 48));
    try {
      const payload = JSON.stringify({ nonce, timestamp, apiKey, ttl: 3600 });
      const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
      return { nonce, encReqData: Buffer.concat([Buffer.from('Salted__', 'ascii'), salt, ciphertext]).toString('base64') };
    } finally {
      material.fill(0);
    }
  } catch {
    throw failure('ENCRYPTION_FAILED', 'Token request encryption failed');
  }
}

function decryptAppUserTokenResponse({ encResData, apiSecret, expectedNonce }) {
  let response;
  try {
    if (typeof encResData !== 'string' || typeof apiSecret !== 'string' || !apiSecret || typeof expectedNonce !== 'string' || !/^[0-9a-f]{64}$/.test(expectedNonce)) throw new Error();
    const base64 = encResData.replace(/\s+/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error();
    const raw = Buffer.from(base64, 'base64');
    if (raw.toString('base64') !== base64 || raw.length < 32 || (raw.length - 16) % 16 !== 0 || !raw.subarray(0, 8).equals(Buffer.from('Salted__'))) throw new Error();
    const material = deriveMaterial(apiSecret, raw.subarray(8, 16));
    let plaintext;
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32, 48));
      plaintext = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
      response = JSON.parse(plaintext.toString('utf8'));
    } finally {
      material.fill(0);
      if (plaintext) plaintext.fill(0);
    }
    if (!response || typeof response.jwt !== 'string' || !/^[\x21-\x7e]+$/.test(response.jwt) || typeof response.nonce !== 'string') throw new Error();
  } catch {
    throw failure('DECRYPTION_FAILED', 'Token response decryption failed');
  }
  const echoedNonce = Buffer.from(response.nonce, 'utf8');
  const nonce = Buffer.from(expectedNonce, 'utf8');
  if (echoedNonce.length !== nonce.length || !crypto.timingSafeEqual(echoedNonce, nonce)) {
    throw failure('NONCE_MISMATCH', 'Token response nonce did not match');
  }
  return { jwt: response.jwt };
}

function controllerOrigin(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw failure('INVALID_BASE_URL', 'Privilege controller URL must be an HTTPS origin');
  }
}

// Bound the complete request, including JSON reading. A race also bounds an
// injected transport that ignores abort; production fetch receives the signal.
async function requestJson({ fetchImpl, url, options, timeoutMs, stage, onStatus }) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(failure('UPSTREAM_TIMEOUT', 'Privilege request timed out'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let response;
      try {
        response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
      } catch {
        throw failure('UPSTREAM_NETWORK_ERROR', 'Privilege network or TLS request failed');
      }
      if (controller.signal.aborted) throw failure('UPSTREAM_TIMEOUT', 'Privilege request timed out');
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
        throw failure('INVALID_UPSTREAM_RESPONSE', 'Privilege returned an invalid response');
      }
      onStatus(response.status);
      if (response.status < 200 || response.status >= 300) {
        const message = stage === 'users-list' && response.status === 401
          ? 'Privilege rejected the JWT; expiry is one possible cause. Verify the key, owning user, environment, and permissions, then run again.'
          : 'Privilege request returned an unsuccessful HTTP status';
        throw failure('UPSTREAM_HTTP_ERROR', message);
      }
      try {
        return await response.json();
      } catch {
        throw failure('INVALID_UPSTREAM_JSON', 'Privilege returned invalid JSON');
      }
    })()]);
  } finally {
    clearTimeout(timer);
  }
}

async function runPrivilegeUserApiKeyFlow({ environmentId, userId, apiKey, apiSecret, baseUrl = process.env.PRIVILEGE_USER_API_BASE_URL || DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, now, randomBytes, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const stages = [];
  let stage = 'encryption';
  let httpStatus;
  try {
    validateCredentials({ environmentId, userId, apiKey, apiSecret });
    const origin = controllerOrigin(baseUrl);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS || typeof fetchImpl !== 'function') {
      throw failure('INVALID_CONFIGURATION', 'Privilege request configuration is invalid');
    }
    const { nonce, encReqData } = encryptAppUserTokenRequest({ environmentId, userId, apiKey, apiSecret, now, randomBytes });
    stages.push({ stage, status: 'success' });
    stage = 'token-request';
    const tokenSession = crypto.randomUUID();
    const tokenBody = await requestJson({ fetchImpl, url: `${origin}/pubapi/${environmentId}/v1/appusertoken`, timeoutMs, stage, onStatus: status => { httpStatus = status; }, options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-procyon-session-id': tokenSession },
      body: JSON.stringify({ ObjectMeta: { Tenant: environmentId, Namespace: 'default', Name: userId }, GuestMetaReq: { APIKey: apiKey, Tenant: environmentId, Namespace: 'default', EncReqData: encReqData } }),
    } });
    if (typeof tokenBody?.GuestMetaRes?.EncResData !== 'string' || !tokenBody.GuestMetaRes.EncResData) {
      throw failure('INVALID_TOKEN_RESPONSE', 'Privilege returned an invalid token response');
    }
    stages.push({ stage, status: 'success', httpStatus });
    stage = 'decryption';
    const { jwt } = decryptAppUserTokenResponse({ encResData: tokenBody.GuestMetaRes.EncResData, apiSecret, expectedNonce: nonce });
    stages.push({ stage, status: 'success' });
    stage = 'users-list';
    httpStatus = undefined;
    const usersSession = crypto.randomUUID();
    if (usersSession === tokenSession) {
      throw failure('SESSION_ID_FAILED', 'Privilege request session creation failed');
    }
    const users = await requestJson({ fetchImpl, url: `${origin}/api/${environmentId}/v1/users`, timeoutMs, stage, onStatus: status => { httpStatus = status; }, options: {
      method: 'GET', headers: { Authorization: `Bearer ${jwt}`, 'x-procyon-session-id': usersSession },
    } });
    stages.push({ stage, status: 'success', httpStatus });
    const jwtPreview = jwt.length > 8 ? `${jwt.slice(0, 4)}****${jwt.slice(-4)}` : '********';
    // Scrub untrusted user JSON here, while every flow secret is still in scope.
    // The route cannot discover the JWT, nonce, or ciphertext echoes later.
    const encResData = tokenBody.GuestMetaRes.EncResData;
    return { ok: true, stages, httpStatus, users: redactFlowData(users, [apiKey, apiSecret, jwt, nonce, encReqData, encResData]), jwtPreview };
  } catch (error) {
    // Only errors constructed here may contribute diagnostics. Never copy an
    // upstream message, body, headers, ciphertext or token into this result.
    const known = error instanceof FlowError;
    stages.push({ stage, status: 'error', ...(httpStatus !== undefined ? { httpStatus } : {}) });
    return { ok: false, stages, ...(httpStatus !== undefined ? { httpStatus } : {}), code: known ? error.code : 'PRIVILEGE_FLOW_FAILED', error: known ? error.message : 'Privilege token flow failed' };
  }
}

module.exports = { encryptAppUserTokenRequest, decryptAppUserTokenResponse, runPrivilegeUserApiKeyFlow };
