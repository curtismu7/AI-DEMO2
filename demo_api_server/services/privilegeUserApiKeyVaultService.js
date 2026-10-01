'use strict';

const path = require('node:path');

const API_KEY_ENTRY = 'PRIVILEGE_USER_API_KEY';
const API_SECRET_ENTRY = 'PRIVILEGE_USER_API_SECRET';
const DEFAULT_BASE_URL = 'https://privilege.test-one-pingone.com';
const DEFAULT_VAULT_PATH = path.resolve(__dirname, '../../secrets.vault');

function maskedPreview(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function getPrivilegeUserApiKeyStatus({
  configStore = require('./configStore'),
  baseUrl = process.env.PRIVILEGE_USER_API_BASE_URL || DEFAULT_BASE_URL,
} = {}) {
  const apiKey = configStore.getVaultValue(API_KEY_ENTRY);
  const apiSecret = configStore.getVaultValue(API_SECRET_ENTRY);
  const missingEntries = [];
  if (!apiKey) missingEntries.push(API_KEY_ENTRY);
  if (!apiSecret) missingEntries.push(API_SECRET_ENTRY);
  return {
    apiKeySet: Boolean(apiKey),
    apiSecretSet: Boolean(apiSecret),
    apiKeyPreview: maskedPreview(apiKey),
    apiSecretPreview: maskedPreview(apiSecret),
    missingEntries,
    controllerUrl: baseUrl,
  };
}

function serviceError(code, message, httpStatus) {
  return Object.assign(new Error(message), { code, httpStatus });
}

// Dependencies, including vaultPath, are server-owned options. The route must
// map only its three credential fields, never forward a request options object.
async function savePrivilegeUserApiCredentials({
  apiKey,
  apiSecret,
  password,
  configStore = require('./configStore'),
  vaultLib = require('../lib/vault'),
  vaultPath = (process.env.VAULT_PATH || '').trim() || DEFAULT_VAULT_PATH,
  logger = console,
}) {
  const updates = {};
  if (typeof apiKey === 'string' && apiKey.trim()) updates[API_KEY_ENTRY] = apiKey;
  if (typeof apiSecret === 'string' && apiSecret.trim()) updates[API_SECRET_ENTRY] = apiSecret;
  if (!Object.keys(updates).length) {
    throw serviceError('PRIVILEGE_USER_API_CREDENTIALS_REQUIRED', 'Provide an API key or API secret.', 400);
  }
  if (typeof password !== 'string' || !password.trim()) {
    throw serviceError('VAULT_PASSWORD_REQUIRED', 'The current vault password is required.', 400);
  }

  let vault;
  try {
    vault = await vaultLib.openVault(vaultPath, password, { caller: 'privilegeUserApiKeyVaultService' });
  } catch (err) {
    if (err.name === 'VaultAuthError' || err.name === 'VaultIntegrityError') {
      throw serviceError('VAULT_AUTH_FAILED', 'Unable to unlock the vault.', 401);
    }
    if (err.name === 'VaultNotFoundError' || err.code === 'ENOENT') {
      throw serviceError('VAULT_NOT_FOUND', 'The configured vault is unavailable.', 404);
    }
    throw serviceError('VAULT_OPEN_FAILED', 'Unable to open the vault.', 500);
  }

  try {
    try {
      for (const [name, value] of Object.entries(updates)) vault.set(name, value);
      await vault.save();
    } catch (_) {
      throw serviceError('VAULT_SAVE_FAILED', 'Unable to save credentials to the vault.', 500);
    }
    try {
      await configStore.setRaw(updates, { persist: false });
    } catch (_) {
      throw serviceError('VAULT_CACHE_REFRESH_FAILED', 'Credentials were saved, but the configuration cache could not be refreshed.', 500);
    }
  } finally {
    try { vault.close(); } catch (_) {
      logger.error('[privilegeUserApiKeyVaultService] vault close failed');
    }
  }
  return getPrivilegeUserApiKeyStatus({ configStore });
}

module.exports = { getPrivilegeUserApiKeyStatus, savePrivilegeUserApiCredentials };
