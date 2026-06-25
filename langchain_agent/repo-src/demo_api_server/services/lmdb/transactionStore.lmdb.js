'use strict';
/**
 * transactionStore.lmdb.js — LMDB-backed transaction persistence.
 *
 * Mirrors the SQLite layer in data/store.js:
 *   persistTransaction(tx)   → void  (upsert one transaction)
 *   loadTransactions()       → transaction[]  (all stored transactions)
 *   removeTransaction(id)    → void
 *
 * Transaction shape from data/store.js:
 *   { id, userId, fromAccountId, toAccountId, amount, type, description,
 *     merchant, category, status, createdAt, updatedAt }
 *
 * NOT imported by data/store.js. Wire in by replacing the SQLite upsert calls
 * inside _initializeSQLiteTransactions and addTransaction.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'transactions';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function persistTransaction(tx) {
  _db().putSync(tx.id, tx);
}

function loadTransactions() {
  const results = [];
  for (const { value } of _db().getRange()) {
    results.push(value);
  }
  return results;
}

function removeTransaction(id) {
  _db().removeSync(id);
}

module.exports = { persistTransaction, loadTransactions, removeTransaction };
