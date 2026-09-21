'use strict';

/**
 * Durable, public-safe association between a user-owned PingOne agent and the
 * demo's mocked CIMD registration. Secrets remain in oauthClientRegistry's
 * existing mock registry and are never copied into this store.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'personal_agent_cimd';

function db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function put(record) {
  db().putSync(record.userKey, record);
}

function get(userKey) {
  return db().get(userKey) || null;
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

module.exports = { put, get, loadAll, clearAll, DB_NAME };
