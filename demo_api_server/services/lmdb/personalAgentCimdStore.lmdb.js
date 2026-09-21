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

function recordKey(userKey, agentType = 'personal') {
  return `${userKey}:${agentType}`;
}

function put(record) {
  const agentType = record.agentType || 'personal';
  db().putSync(recordKey(record.userKey, agentType), { ...record, agentType });
}

function get(userKey, agentType = 'personal') {
  return db().get(recordKey(userKey, agentType)) || db().get(userKey) || null;
}

function remove(userKey, agentType = 'personal') {
  db().removeSync(recordKey(userKey, agentType));
  if (agentType === 'personal') db().removeSync(userKey);
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

module.exports = { put, get, remove, loadAll, clearAll, recordKey, DB_NAME };
