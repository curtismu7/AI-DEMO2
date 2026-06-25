'use strict';
/**
 * delegationStore.lmdb.js — LMDB-backed delegation storage.
 *
 * Mirrors the SQLite layer in delegationService.js:
 *   grantDelegation(delegation)         → { id }
 *   revokeDelegation(id)                → void
 *   getDelegations(userId)              → delegation[]  (delegator OR delegate)
 *   getDelegationById(id)               → delegation | null
 *
 * Delegation shape:
 *   { id, delegator_user_id, delegate_user_id, delegate_email,
 *     delegator_email, scopes, status, granted_at, revoked_at }
 *
 * scopes stored as JS array (not JSON string — LMDB serialises natively).
 *
 * NOT imported by delegationService.js. Wire in by replacing the SQLite
 * getStorage() branch.
 */
const { randomUUID } = require('node:crypto');
const { openEnv } = require('./openEnv');

const DB_NAME = 'delegations';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function grantDelegation({ delegator_user_id, delegate_user_id, delegate_email, delegator_email, scopes, status = 'active' }) {
  const id = randomUUID();
  const record = {
    id,
    delegator_user_id,
    delegate_user_id: delegate_user_id || null,
    delegate_email,
    delegator_email: delegator_email || null,
    scopes: Array.isArray(scopes) ? scopes : [],
    status,
    granted_at: new Date().toISOString(),
    revoked_at: null,
  };
  _db().putSync(id, record);
  return { id };
}

function revokeDelegation(id) {
  const db = _db();
  const record = db.get(id);
  if (!record) return;
  db.putSync(id, { ...record, status: 'revoked', revoked_at: new Date().toISOString() });
}

function getDelegations(userId) {
  const results = [];
  for (const { value } of _db().getRange()) {
    if (value.delegator_user_id === userId || value.delegate_user_id === userId) {
      results.push(value);
    }
  }
  return results;
}

function getDelegationById(id) {
  return _db().get(id) || null;
}

module.exports = { grantDelegation, revokeDelegation, getDelegations, getDelegationById };
