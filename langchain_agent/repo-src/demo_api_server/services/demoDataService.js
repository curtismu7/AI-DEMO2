'use strict';
const crypto = require('crypto');
const { getDb } = require('./lmdb/openEnv');

function _db() { return getDb('demo_accounts'); }

async function getDemoAccounts(userId = null) {
  try {
    const results = [];
    for (const { value } of _db().getRange()) {
      if (!userId || value.userId === userId) results.push(value);
    }
    return results.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } catch (err) {
    console.error('[demoDataService] getDemoAccounts error:', err.message);
    return [];
  }
}

async function createDemoAccount(accountData) {
  const { userId, accountType, accountNumber, routingNumber, balance, currency = 'USD', status = 'active' } = accountData;
  if (!userId || !accountType || !accountNumber || !routingNumber || balance === undefined) {
    throw new Error('Missing required fields');
  }
  const account = {
    id: crypto.randomUUID(),
    userId,
    accountType,
    accountNumber,
    routingNumber,
    balance: parseFloat(balance),
    currency,
    status,
    createdAt: new Date().toISOString(),
  };
  _db().putSync(account.id, account);
  return account;
}

async function deleteDemoAccount(accountId, userId) {
  try {
    const existing = _db().get(accountId);
    if (!existing || existing.userId !== userId) return { ok: false, error: 'not_found' };
    _db().removeSync(accountId);
    return { ok: true };
  } catch (err) {
    console.error('[demoDataService] deleteDemoAccount error:', err.message);
    return { ok: false, error: 'internal_error' };
  }
}

async function migrateAccounts() {
  const existing = await getDemoAccounts();
  if (existing.length > 0) return { ok: true, migrated: 0, existing: existing.length };
  return { ok: true, migrated: 0, existing: 0 };
}

function getBackendInfo() {
  return { backend: 'lmdb', useSQLite: false, accountCount: null };
}

module.exports = { getDemoAccounts, createDemoAccount, deleteDemoAccount, migrateAccounts, getBackendInfo, useSQLite: false };
