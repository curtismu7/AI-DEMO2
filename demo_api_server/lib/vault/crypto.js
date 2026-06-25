'use strict';

/**
 * Crypto primitives for the portable encrypted credential vault (Phase 269).
 *
 * Frozen choices (per 269-RESEARCH.md):
 *   - AES-256-GCM AEAD via node:crypto (same primitive used in services/configStore.js)
 *   - Argon2id KDF via the `argon2` npm package; parameters OWASP-recommended 2025
 *   - HKDF-SHA256 sub-key for the whole-file HMAC (key derived from KEK + 'fileHmac/v1')
 *
 * Module hygiene: NO console.log anywhere. NO logging callers' values. Debugging
 * is via tests.
 */

const crypto = require('node:crypto');
const argon2 = require('argon2');

/**
 * Argon2id parameters — FROZEN. Do not change without bumping the on-disk
 * format version and adding a migration path.
 *
 * m=64 MiB, t=3 iterations, p=4 lanes → ~100ms per attempt on commodity GPU.
 */
const KDF_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
});

/**
 * Derive a 32-byte KEK from a password + salt using Argon2id.
 *
 * @param {string} password
 * @param {Buffer} saltBuf
 * @returns {Promise<Buffer>} 32-byte Buffer
 */
async function deriveKek(password, saltBuf) {
  const raw = await argon2.hash(password, {
    ...KDF_PARAMS,
    salt: saltBuf,
    raw: true,
  });
  return Buffer.from(raw);
}

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

/**
 * Derive the whole-file HMAC sub-key from the KEK via HKDF-SHA256.
 * Same KEK → same sub-key (deterministic).
 *
 * @param {Buffer} kek  32 bytes
 * @returns {Buffer} 32-byte sub-key
 */
function hkdfFileHmacKey(kek) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) {
    throw new Error('kek must be 32 bytes');
  }
  // node:crypto.hkdfSync returns ArrayBuffer; wrap in Buffer for consistent API.
  return Buffer.from(
    crypto.hkdfSync('sha256', kek, Buffer.alloc(0), Buffer.from('fileHmac/v1'), 32),
  );
}

module.exports = {
  KDF_PARAMS,
  deriveKek,
  aeadSeal,
  aeadOpen,
  hkdfFileHmacKey,
};
