'use strict';

const crypto = require('node:crypto');
const { openEnv } = require('./openEnv');
const { aeadSeal, aeadOpen } = require('../../lib/aead');

const DB_NAME = 'delegated_commerce_registrations';
const CREDENTIAL_SALT = 'delegated-commerce-credential-v1';

function _db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function put(record) {
  _db().putSync(record.id, record);
  return record;
}

function credentialKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error('Delegated commerce credentials require CONFIG_ENCRYPTION_KEY or SESSION_SECRET.');
  }
  return crypto.scryptSync(raw, CREDENTIAL_SALT, 32);
}

function encryptClientSecret(clientSecret) {
  const { iv, tag, ct } = aeadSeal(clientSecret, credentialKey());
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

function decryptClientSecret(record) {
  const [iv, tag, ct] = String(record?.encryptedClientSecret || '').split('.');
  if (!iv || !tag || !ct) return null;
  return aeadOpen(
    {
      iv: Buffer.from(iv, 'base64'),
      tag: Buffer.from(tag, 'base64'),
      ct: Buffer.from(ct, 'base64'),
    },
    credentialKey(),
  ).toString('utf8');
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

module.exports = {
  put,
  get,
  remove,
  findByClaimCodeHash,
  list,
  encryptClientSecret,
  decryptClientSecret,
};
