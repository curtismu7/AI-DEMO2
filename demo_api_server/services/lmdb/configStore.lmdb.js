'use strict';
/**
 * configStore.lmdb.js — LMDB-backed config persistence.
 *
 * Mirrors the SQLite layer in configStore.js:
 *   loadAll()           → [{ key, value, updated_at }]
 *   upsert(key, value)  → void
 *   remove(key)         → void
 *
 * NOT imported by configStore.js. Wire in by replacing _getSQLite() calls.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'config';

function _db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function loadAll() {
  const db = _db();
  const rows = [];
  for (const { key, value } of db.getRange()) {
    rows.push({ key, value: value.value, updated_at: value.updated_at });
  }
  return rows;
}

function upsert(key, value) {
  const db = _db();
  db.putSync(key, { value, updated_at: new Date().toISOString() });
}

function remove(key) {
  const db = _db();
  db.removeSync(key);
}

module.exports = { loadAll, upsert, remove };
