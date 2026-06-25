'use strict';
/**
 * bankingDb — LMDB-backed banking resource server storage.
 *
 * Replaces the former better-sqlite3 implementation.
 * Public API is unchanged: initBankingDb / getAccountsByUserId / getTransactionsByUserId.
 */

const { getDb } = require('./lmdb/openEnv');

const DEFAULT_TX_LIMIT = 50;

// For testing: allow path override (no-op now, kept for API compat)
let _testPathOverride = null;
function _setDbPath(newPath) { _testPathOverride = newPath; }

function _accounts() { return getDb('banking_accounts'); }
function _txns()     { return getDb('banking_transactions'); }

function _seed() {
  const dataStore = require('../data/store');
  if (typeof dataStore.getAllAccounts !== 'function' || typeof dataStore.getAllTransactions !== 'function') {
    throw new Error('[bankingDb] data/store.js missing getAllAccounts/getAllTransactions');
  }
  const acctDb = _accounts();
  const txDb   = _txns();
  for (const a of dataStore.getAllAccounts()) {
    acctDb.putSync(`id:${a.id}`, a);
    acctDb.putSync(`user:${a.userId}:${a.id}`, a);
  }
  for (const t of dataStore.getAllTransactions()) {
    const ts = t.createdAt instanceof Date ? t.createdAt.toISOString() : (t.createdAt || new Date().toISOString());
    txDb.putSync(`id:${t.id}`, t);
    txDb.putSync(`user:${t.userId}:${ts}:${t.id}`, t);
  }
}

let _initialized = false;

function initBankingDb() {
  if (_initialized) return;
  _initialized = true;
  const acctDb = _accounts();
  let hasData = false;
  for (const _ of acctDb.getRange({ limit: 1 })) { hasData = true; break; }
  if (!hasData) {
    try {
      _seed();
      console.log('[bankingDb] Seeded banking data from data/store.js into LMDB');
    } catch (err) {
      console.error('[bankingDb] Seed failed:', err.message);
    }
  } else {
    console.log('[bankingDb] LMDB banking data already present; skipping seed');
  }
}

function getAccountsByUserId(userId) {
  const prefix = `user:${userId}:`;
  const results = [];
  for (const { key, value } of _accounts().getRange({ start: prefix })) {
    if (!key.startsWith(prefix)) break;
    results.push(value);
  }
  return results;
}

function getTransactionsByUserId(userId, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_TX_LIMIT;
  const prefix = `user:${userId}:`;
  const all = [];
  for (const { key, value } of _txns().getRange({ start: prefix })) {
    if (!key.startsWith(prefix)) break;
    all.push(value);
  }
  // Sort descending by createdAt — keys are ASC, so reverse
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return all.slice(0, cap);
}

module.exports = { initBankingDb, getAccountsByUserId, getTransactionsByUserId, _setDbPath };
