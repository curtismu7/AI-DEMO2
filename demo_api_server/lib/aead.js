'use strict';

/**
 * AEAD primitives (AES-256-GCM via node:crypto).
 *
 * Relocated verbatim from lib/vault/crypto.js so the encrypted-credential vault
 * can later be removed without breaking the two non-vault LMDB stores that also
 * seal/open records with these helpers (services/lmdb/delegatedCommerceStore and
 * services/lmdb/sdkDemoTokenStore). Behavior is identical to the original — same
 * implementation, same errors, same key/iv/tag guards.
 *
 * Module hygiene: NO console.log anywhere. NO logging callers' values.
 */

const crypto = require('node:crypto');

/**
 * AEAD-seal `plaintext` under `key` (AES-256-GCM with a fresh random 12-byte IV).
 *
 * @param {Buffer|string} plaintext
 * @param {Buffer} key  32 bytes
 * @returns {{ iv: Buffer, tag: Buffer, ct: Buffer }}
 */
function aeadSeal(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('key must be 32 bytes');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ct };
}

/**
 * AEAD-open a previously-sealed payload. Throws on tag mismatch (caller sees
 * the bare node:crypto error — DO NOT wrap with a leakier message).
 *
 * @param {{ iv: Buffer, tag: Buffer, ct: Buffer }} payload
 * @param {Buffer} key  32 bytes
 * @returns {Buffer} decrypted plaintext
 */
function aeadOpen(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('key must be 32 bytes');
  }
  const { iv, tag, ct } = payload;
  if (!Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error('iv must be 12 bytes');
  }
  if (!Buffer.isBuffer(tag) || tag.length !== 16) {
    throw new Error('tag must be 16 bytes');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

module.exports = {
  aeadSeal,
  aeadOpen,
};
