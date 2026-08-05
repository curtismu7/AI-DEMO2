'use strict';

const { openEnv } = require('./openEnv');

const DB_NAME = 'delegated_commerce_registrations';

function _db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function put(record) {
  _db().putSync(record.id, record);
  return record;
}

function get(id) {
  return _db().get(id) || null;
}

function remove(id) {
  _db().removeSync(id);
}

function findByClaimCodeHash(claimCodeHash) {
  for (const { value } of _db().getRange()) {
    if (value.claimCodeHash === claimCodeHash) return value;
  }
  return null;
}

function list() {
  return [..._db().getRange()].map(({ value }) => value);
}

module.exports = { put, get, remove, findByClaimCodeHash, list };
