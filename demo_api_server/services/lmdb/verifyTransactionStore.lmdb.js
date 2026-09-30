'use strict';

const { openEnv } = require('./openEnv');

const DB_NAME = 'verify_transactions';
const KEY_PREFIX = 'verify:';
const KEY_END = 'verify;';
const FIELDS = new Set([
  'id',
  'appUserId',
  'pingOneUserId',
  'status',
  'expiresAt',
  'verifiedAt',
  'createdAt',
  'updatedAt',
]);

function db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function sanitize(record) {
  const safe = {};
  for (const field of FIELDS) {
    if (record?.[field] !== undefined) safe[field] = record[field];
  }
  return safe;
}

function get(id) {
  const value = db().get(`${KEY_PREFIX}${String(id)}`);
  return value ? sanitize(value) : null;
}

function save(record) {
  if (!record?.id || !record.appUserId || !record.pingOneUserId) {
    throw new TypeError('Verify transaction ownership is required');
  }
  const key = `${KEY_PREFIX}${String(record.id)}`;
  const previous = db().get(key) || {};
  db().putSync(key, sanitize({ ...previous, ...record }));
  return get(record.id);
}

function pruneExpired(now = Date.now()) {
  const database = db();
  const expiredKeys = [];
  for (const { key, value } of database.getRange({ start: KEY_PREFIX, end: KEY_END })) {
    const expiry = Date.parse(value?.expiresAt || '');
    if (!Number.isFinite(expiry) || expiry <= now) expiredKeys.push(key);
  }
  for (const key of expiredKeys) database.removeSync(key);
  return expiredKeys.length;
}

module.exports = { get, save, pruneExpired, DB_NAME };
