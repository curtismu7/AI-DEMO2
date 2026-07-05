'use strict';
/**
 * sdkDemoTokenStore.lmdb.js — LMDB persistence for the OIDC SDK centralized-login
 * demo (/sdk-login). The browser SDK (@forgerock/oidc-client) is wired with a
 * `custom` storage adapter that round-trips token reads/writes to the BFF
 * (routes/sdkDemoTokens.js), which persists them here so they survive restarts.
 *
 * Tokens are sensitive, so values are encrypted at rest (AES-256-GCM) with a key
 * derived from CONFIG_ENCRYPTION_KEY / SESSION_SECRET — same approach as
 * services/configStore.js. Entries are scoped per browser by the caller's
 * express-session id so visitors never share a token blob.
 *
 * Key layout (single LMDB DB named 'sdk_demo_tokens'):
 *   <sessionId>:<sdkStorageKey> -> { enc, updated_at }
 */
const crypto = require('node:crypto');
const { openEnv } = require('./openEnv');
const { aeadSeal, aeadOpen } = require('../../lib/vault/crypto');

const DB_NAME = 'sdk_demo_tokens';

let _dbHandle = null;
function _db() {
  if (!_dbHandle) {
    _dbHandle = openEnv().openDB(DB_NAME, { encoding: 'json' });
  }
  return _dbHandle;
}

let _key = null;
let _warnedFallback = false;
function _encKey() {
  if (_key) return _key;
  let raw = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw) {
    // No configured key. Encrypting tokens with an in-source constant is
    // effectively plaintext, so refuse it in production; in dev, fall back but
    // warn loudly (once) so it can't pass unnoticed.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'sdkDemoTokenStore: CONFIG_ENCRYPTION_KEY or SESSION_SECRET must be set in production ' +
        '(refusing to encrypt SDK demo tokens with the in-source dev fallback key)'
      );
    }
    if (!_warnedFallback) {
      _warnedFallback = true;
      console.warn('[sdkDemoTokenStore] ⚠️  no CONFIG_ENCRYPTION_KEY/SESSION_SECRET set — using the in-source dev fallback key (NOT for production)');
    }
    raw = 'dev-fallback-key-do-not-use-in-production';
  }
  _key = crypto.scryptSync(raw, 'sdk-demo-token-salt-v1', 32);
  return _key;
}

// Cipher via the shared vault AEAD primitive (lib/vault/crypto) — same AES-256-GCM
// used by configStore, not a third copy. Serialized as base64 iv.tag.ct.
function _encrypt(plaintext) {
  const { iv, tag, ct } = aeadSeal(String(plaintext), _encKey());
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

function _decrypt(blob) {
  const [ivB, tagB, ctB] = String(blob).split('.');
  if (!ivB || !tagB || !ctB) throw new Error('malformed ciphertext');
  return aeadOpen(
    { iv: Buffer.from(ivB, 'base64'), tag: Buffer.from(tagB, 'base64'), ct: Buffer.from(ctB, 'base64') },
    _encKey(),
  ).toString('utf8');
}

const _composite = (sid, key) => `${sid}:${key}`;

/** Returns the stored plaintext string, or null if missing/undecryptable. */
function get(sid, key) {
  const row = _db().get(_composite(sid, key));
  if (!row?.enc) return null;
  try {
    return _decrypt(row.enc);
  } catch {
    return null;
  }
}

function put(sid, key, value) {
  _db().putSync(_composite(sid, key), { enc: _encrypt(value), updated_at: new Date().toISOString() });
}

function remove(sid, key) {
  _db().removeSync(_composite(sid, key));
}

/** Prune every entry for one browser session (used on logout). */
function clearSession(sid) {
  const db = _db();
  const keys = [];
  // Composite keys are `${sid}:...`; ';' is the next char after ':' so the range
  // [sid:, sid;) captures exactly this session's rows.
  for (const { key } of db.getRange({ start: `${sid}:`, end: `${sid};` })) keys.push(key);
  for (const k of keys) db.removeSync(k);
}

/** Drop every entry in the store (used on boot when CLEAR_SESSIONS_ON_BOOT is active). */
function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange({})) keys.push(key);
  for (const k of keys) db.removeSync(k);
}

module.exports = { get, put, remove, clearSession, clearAll };
