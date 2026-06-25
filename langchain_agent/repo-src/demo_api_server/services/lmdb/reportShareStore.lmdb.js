'use strict';
/**
 * reportShareStore.lmdb.js — LMDB persistence for report share tokens
 * (routes/reports.js), so a shared report link keeps working after a restart
 * until it expires.
 *
 * Kept separate from the 'reports' DB on purpose: that DB's findRun/listAllRuns
 * do unprefixed full scans and would otherwise mis-read share entries as runs.
 *
 * Key layout (single LMDB DB named 'report_shares'):
 *   <shareToken> -> { runId, userId, expiresAt }
 *
 * Expiry is enforced by the route (and a lazy delete here on read); LMDB has no
 * native TTL.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'report_shares';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

/** Returns the entry, or null if missing/expired (expired rows are pruned on read). */
function get(token) {
  const entry = _db().get(token);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() >= entry.expiresAt) {
    _db().removeSync(token);
    return null;
  }
  return entry;
}

function put(token, entry) { _db().putSync(token, entry); }
function remove(token) { _db().removeSync(token); }

/** @returns {[token, entry][]} — used by the periodic cleanup to prune expired rows. */
function loadAll() {
  const out = [];
  for (const { key, value } of _db().getRange()) out.push([key, value]);
  return out;
}

function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange()) keys.push(key);
  for (const key of keys) db.removeSync(key);
}

module.exports = { get, put, remove, loadAll, clearAll };
