'use strict';
/**
 * cimdStore.lmdb.js — LMDB-backed persistence for Client ID Metadata Documents
 * registered via POST /api/clients/register (routes/clientRegistration.js).
 *
 * The CIMD documents are served publicly from /.well-known/oauth-client/:clientId.
 * Without persistence the in-memory Map emptied on restart and every previously
 * registered client's well-known URL started returning 404. The route
 * write-throughs each registration here and calls hydrate() at boot.
 *
 * Key layout (single LMDB DB named 'cimd'):
 *   <pingOneApplicationId> -> CIMD document object
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'cimd';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

/** @returns {[appId, cimdDoc][]} */
function loadAll() {
  const out = [];
  for (const { key, value } of _db().getRange()) out.push([key, value]);
  return out;
}

function put(appId, doc) { _db().putSync(appId, doc); }

function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange()) keys.push(key);
  for (const key of keys) db.removeSync(key);
}

module.exports = { loadAll, put, clearAll };
