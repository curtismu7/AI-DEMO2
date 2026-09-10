'use strict';
/**
 * mcpOAuthConfigStore.js — illustrative OAuth config for the banking-mcp
 * Agentic App registration on PingOne Privilege. See privilege/CURRENT-
 * CONFIGURATION.md for why Auth Mode OAuth is a documented platform
 * blocker on the live gateway; this store just persists what the admin
 * page's form holds, it doesn't make that path work.
 *
 * clientSecret is never returned by getConfig()/saveConfig() — only
 * hasClientSecret. routes/mcpOAuthConfig.js's Test Connection endpoint is
 * the only caller that reads the real secret, via getConfigWithSecret().
 */
const lmdb = require('./lmdb/mcpOAuthConfigStore.lmdb');

const RECORD_ID = 'banking-mcp';

const EMPTY = {
  clientId: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '',
};

function maskConfig(record) {
  if (!record) return { ...EMPTY, hasClientSecret: false };
  const { clientSecret, ...rest } = record;
  return { ...rest, hasClientSecret: !!clientSecret };
}

function getConfig() {
  return maskConfig(lmdb.getConfig(RECORD_ID));
}

/** Full record including the secret — routes/mcpOAuthConfig.js's Test Connection only. */
function getConfigWithSecret() {
  return lmdb.getConfig(RECORD_ID);
}

function saveConfig({ clientId, clientSecret, issuer, tokenEndpoint, scopes, audience }) {
  const existing = lmdb.getConfig(RECORD_ID);
  const record = {
    clientId: String(clientId || '').trim(),
    // A blank secret on save means "leave it alone" — the UI never gets the
    // real value back to resend, so it can't round-trip it on every save.
    clientSecret: clientSecret ? String(clientSecret).trim() : (existing && existing.clientSecret) || '',
    issuer: String(issuer || '').trim(),
    tokenEndpoint: String(tokenEndpoint || '').trim(),
    scopes: String(scopes || '').trim(),
    audience: String(audience || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  lmdb.saveConfig(RECORD_ID, record);
  return maskConfig(record);
}

module.exports = { getConfig, getConfigWithSecret, saveConfig };
