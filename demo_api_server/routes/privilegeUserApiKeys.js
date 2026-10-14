'use strict';

const router = require('express').Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const configStore = require('../services/configStore');
const vaultLib = require('../lib/vault');
const { DEFAULT_VAULT_PATH } = require('../services/vaultLoader');
const { getPrivilegeUserApiKeyStatus, savePrivilegeUserApiCredentials } = require('../services/privilegeUserApiKeyVaultService');
const { runPrivilegeUserApiKeyFlow } = require('../services/privilegeUserApiKeyService');
const { redactCompactJwts, containsCompactJwt } = require('../utils/redactCompactJwt');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAULT_ERRORS = {
  PRIVILEGE_USER_API_CREDENTIALS_REQUIRED: [400, 'Provide an API key or API secret.'],
  VAULT_PASSWORD_REQUIRED: [400, 'The current vault password is required.'],
  VAULT_AUTH_FAILED: [401, 'Unable to unlock the vault.'],
  VAULT_NOT_FOUND: [404, 'The configured vault is unavailable.'],
  VAULT_OPEN_FAILED: [500, 'Unable to open the vault.'],
  VAULT_SAVE_FAILED: [500, 'Unable to save credentials to the vault.'],
  VAULT_CACHE_REFRESH_FAILED: [500, 'Credentials were saved, but the configuration cache could not be refreshed.'],
};

// Status is readable by any signed-in user so the tab can show what is configured.
// Masked key previews are admin-only: they reveal part of the key.
router.get('/status', authenticateToken, (req, res) => {
  try {
    const status = getPrivilegeUserApiKeyStatus({ configStore });
    if (req.user?.role === 'admin') return res.json(status);
    const { apiKeyPreview, apiSecretPreview, ...configured } = status;
    return res.json(configured);
  } catch {
    return unexpectedFailure(res);
  }
});

router.use(authenticateToken, requireAdmin);

function csrfGuard(req, res, next) {
  if (req.get('x-privilege-user-api-csrf') !== '1') {
    return res.status(403).json({ error: 'Privilege user API CSRF header is required.', code: 'CSRF_REQUIRED' });
  }
  next();
}

function validBody(body, fields) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every(key => fields.includes(key));
}

function unexpectedFailure(res) {
  return res.status(500).json({ error: 'Privilege user API request failed.', code: 'PRIVILEGE_USER_API_FAILED' });
}

function redactUsers(value, credentials) {
  if (Array.isArray(value)) return value.map(item => redactUsers(item, credentials));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !containsCompactJwt(key) && !credentials.some(credential => credential && key.includes(credential)))
      .map(([key, item]) => {
        const name = key.toLowerCase().replace(/[_-]/g, '');
        const sensitive = /^(apikey|apisecret|jwt|authorization|accesstoken|refreshtoken|idtoken|token|password|currentpassword|encreqdata|encresdata|encrypteddata|encryptedpayload|ciphertext)$/.test(name);
        return [key, sensitive ? '[REDACTED]' : redactUsers(item, credentials)];
      }));
  }
  if (typeof value === 'string') {
    let redacted = value;
    for (const credential of credentials) redacted = redacted.split(credential).join('[REDACTED]');
    return redactCompactJwts(redacted).replace(/\bBearer\s+\S+/gi, '[REDACTED]');
  }
  return value;
}

router.post('/credentials', csrfGuard, async (req, res) => {
  if (!validBody(req.body, ['api_key', 'api_secret', 'current_password'])
    || Object.values(req.body).some(value => typeof value !== 'string')) {
    return res.status(400).json({ error: 'Only API key, API secret, and current vault password strings are accepted.', code: 'INVALID_INPUT' });
  }
  try {
    const status = await savePrivilegeUserApiCredentials({
      apiKey: req.body.api_key,
      apiSecret: req.body.api_secret,
      password: req.body.current_password,
      configStore,
      vaultLib,
      vaultPath: (process.env.VAULT_PATH || '').trim() || DEFAULT_VAULT_PATH,
    });
    return res.json(status);
  } catch (error) {
    // Only the fixed service codes select a fixed message/status; never forward
    // exception messages, paths, headers, bodies, passwords or credential values.
    const known = Object.hasOwn(VAULT_ERRORS, error?.code) && VAULT_ERRORS[error.code];
    if (known) return res.status(known[0]).json({ error: known[1], code: error.code });
    return unexpectedFailure(res);
  }
});

router.post('/run', csrfGuard, async (req, res) => {
  if (!validBody(req.body, ['environment_id', 'user_id'])) {
    return res.status(400).json({ error: 'Only Environment ID and User ID strings are accepted.', code: 'INVALID_INPUT' });
  }
  for (const [field, code, label] of [
    ['environment_id', 'INVALID_ENVIRONMENT_ID', 'Environment ID'],
    ['user_id', 'INVALID_USER_ID', 'User ID'],
  ]) {
    if (typeof req.body[field] !== 'string' || req.body[field].length !== 36 || !UUID.test(req.body[field])) {
      return res.status(400).json({ error: `${label} must be a UUID`, code });
    }
  }
  try {
    const apiKey = configStore.getVaultValue('PRIVILEGE_USER_API_KEY');
    const apiSecret = configStore.getVaultValue('PRIVILEGE_USER_API_SECRET');
    const missingEntries = [];
    if (typeof apiKey !== 'string' || !apiKey.trim()) missingEntries.push('PRIVILEGE_USER_API_KEY');
    if (typeof apiSecret !== 'string' || !apiSecret.trim()) missingEntries.push('PRIVILEGE_USER_API_SECRET');
    if (missingEntries.length) {
      return res.status(400).json({ error: 'Privilege user API key and secret are required', code: 'CREDENTIALS_REQUIRED', missingEntries });
    }
    // The service owns the trusted controller URL and fixed requests. Results
    // remain request-local; do not register them with activity/API call trackers.
    const result = await runPrivilegeUserApiKeyFlow({
      environmentId: req.body.environment_id,
      userId: req.body.user_id,
      apiKey,
      apiSecret,
    });
    // Upstream user records are untrusted JSON and may echo secrets. Preserve
    // ordinary records while redacting sensitive fields and credential values.
    return res.json(Object.hasOwn(result, 'users')
      ? { ...result, users: redactUsers(result.users, [apiKey, apiSecret]) }
      : result);
  } catch {
    return unexpectedFailure(res);
  }
});

module.exports = router;
