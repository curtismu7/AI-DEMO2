'use strict';
/**
 * demoAccountStore.lmdb.js — LMDB-backed demo account storage.
 *
 * Mirrors demoDataService.js public API:
 *   getDemoAccounts(userId?)              → account[]
 *   createDemoAccount(accountData)        → account
 *   deleteDemoAccount(accountId, userId)  → boolean
 *
 * Account shape:
 *   { id, userId, accountType, accountNumber, routingNumber,
 *     balance, currency, status, createdAt }
 *
 * NOT imported by demoDataService.js. Wire in by replacing the SQLite
 * module-level init and query functions.
 */
const { randomUUID } = require('node:crypto');
const { openEnv } = require('./openEnv');

const DB_NAME = 'demo_accounts';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function getDemoAccounts(userId) {
  const results = [];
  for (const { value } of _db().getRange()) {
    if (!userId || value.userId === userId) results.push(value);
  }
  return results;
}

function createDemoAccount({ userId, accountType, accountNumber, routingNumber, balance, currency = 'USD', status = 'active' }) {
  const account = {
    id: randomUUID(),
    userId,
    accountType,
    accountNumber,
    routingNumber,
    balance,
    currency,
    status,
    createdAt: new Date().toISOString(),
  };
  _db().putSync(account.id, account);
  return account;
}

function deleteDemoAccount(accountId, userId) {
  const db = _db();
  const existing = db.get(accountId);
  if (!existing || existing.userId !== userId) return false;
  db.removeSync(accountId);
  return true;
}

module.exports = { getDemoAccounts, createDemoAccount, deleteDemoAccount };
