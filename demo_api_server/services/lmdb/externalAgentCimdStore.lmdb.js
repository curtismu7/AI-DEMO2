'use strict';

/**
 * Durable, public-safe record of external agents a user registered through CIMD
 * (mock PingOne facade or PingFederate). Never holds tokens or client secrets.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'external_agent_cimd';

function db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function recordKey(userKey, slug, engine) {
  return `${userKey}:${slug}:${engine}`;
}

function put(record) {
  db().putSync(recordKey(record.userKey, record.slug, record.engine), record);
}

function get(userKey, slug, engine) {
  return db().get(recordKey(userKey, slug, engine)) || null;
}

function loadAll() {
  const records = [];
  for (const { key, value } of db().getRange()) records.push([key, value]);
  return records;
}

function clearAll() {
  const store = db();
  for (const key of store.getKeys()) store.removeSync(key);
}

module.exports = { put, get, loadAll, clearAll, recordKey, DB_NAME };
