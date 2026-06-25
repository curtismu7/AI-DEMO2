'use strict';
/**
 * clientRegistryStore.lmdb.js — LMDB-backed persistence for the dynamic OAuth
 * client registry (services/oauthClientRegistry.js).
 *
 * Without this, every DCR-registered client (and its rotation history) lived
 * only in an in-memory Map and vanished on restart — a demo mid-flow would lose
 * the client it just registered. oauthClientRegistry write-throughs every
 * mutation here and calls hydrate() at boot to repopulate its Maps.
 *
 * Key layout (single LMDB DB named 'oauth_clients'):
 *   client:<clientId>     -> full client record (incl. client_secret)
 *   rotation:<clientId>   -> rotation-tracking record
 *
 * Records are stored as plaintext JSON, matching every other LMDB store in this
 * directory (the session store already persists live OAuth tokens this way).
 * data/persistent/lmdb/ is the trusted local-storage tier; configStore encrypts
 * only because it re-exports secrets through the admin UI, which this store does not.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'oauth_clients';
const CLIENT_PREFIX = 'client:';
const ROTATION_PREFIX = 'rotation:';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function _loadByPrefix(prefix) {
  const out = [];
  for (const { key, value } of _db().getRange({ start: prefix })) {
    if (!key.startsWith(prefix)) break;
    out.push([key.slice(prefix.length), value]);
  }
  return out;
}

/** @returns {[clientId, record][]} */
function loadClients() { return _loadByPrefix(CLIENT_PREFIX); }

/** @returns {[clientId, rotationRecord][]} */
function loadRotations() { return _loadByPrefix(ROTATION_PREFIX); }

function saveClient(clientId, record) { _db().putSync(`${CLIENT_PREFIX}${clientId}`, record); }
function deleteClient(clientId)        { _db().removeSync(`${CLIENT_PREFIX}${clientId}`); }

function saveRotation(clientId, record) { _db().putSync(`${ROTATION_PREFIX}${clientId}`, record); }
function deleteRotation(clientId)        { _db().removeSync(`${ROTATION_PREFIX}${clientId}`); }

/** Wipe every client + rotation row. Used by clearRegistry() (tests / admin reset). */
function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange()) keys.push(key);
  for (const key of keys) db.removeSync(key);
}

module.exports = {
  loadClients, loadRotations,
  saveClient, deleteClient,
  saveRotation, deleteRotation,
  clearAll,
};
