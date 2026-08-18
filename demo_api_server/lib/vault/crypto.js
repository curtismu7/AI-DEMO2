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

// The AEAD primitives were relocated to lib/aead.js so the vault can be removed
// later without breaking the two non-vault LMDB stores that also use them.
// Re-exported here so the vault and its existing tests keep importing them from
// this module during the transition (removed in a later phase).
const { aeadSeal, aeadOpen } = require('../aead');

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
 * Returns a FRESH Buffer that the caller owns and is expected to zero (the
 * vault handle does this in close()). `argon2.hash(..., {raw: true})` allocates
 * its own output Buffer, so copying it left a second live copy of the KEK on
 * the heap that nothing ever wiped — close() zeroed one copy while an identical
 * one waited for the GC. Zero the argon2 buffer here so exactly one copy of the
 * KEK exists per derivation.
 *
 * @param {string} password
 * @param {Buffer} saltBuf
 * @returns {Promise<Buffer>} 32-byte Buffer, owned by the caller
 */
async function deriveKek(password, saltBuf) {
  const raw = await argon2.hash(password, {
    ...KDF_PARAMS,
    salt: saltBuf,
    raw: true,
  });
  const kek = Buffer.from(raw);
  if (Buffer.isBuffer(raw)) raw.fill(0);
  return kek;
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
