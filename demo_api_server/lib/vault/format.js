'use strict';

/**
 * On-disk JSON envelope for the portable encrypted credential vault (Phase 269).
 *
 * Envelope shape (FROZEN — see 269-RESEARCH.md "Pattern 1: KEK / DEK envelope"):
 *   {
 *     magic: "BNKV",
 *     version: 1,
 *     kdf: { alg, salt, memCost, timeCost, parallelism, hashLen },
 *     createdAt, rotatedAt,
 *     seq: <int>,          // rollback counter; absent in pre-269.2 vaults
 *     entries: { NAME: { wrappedDek, valueIv, valueTag, value, updatedAt, note? } },
 *     fileHmac: "<base64>"
 *   }
 *
 * `seq` is inside the HMAC like every other field, so it cannot be raised
 * without the password. It is optional on read: a vault written before the
 * counter existed still parses, and index.js treats its absence as 0.
 *
 * Canonical JSON: keys sorted alphabetically at every level, arrays preserve order.
 * Determinism is required so the whole-file HMAC is reproducible.
 *
 * Module hygiene: does NOT require ./crypto — keeps this module usable for
 * golden-file scripts and format inspection without pulling in the argon2
 * native module.
 */

const crypto = require('node:crypto');
const { VaultIntegrityError } = require('./errors');

const MAGIC = 'BNKV';
const VERSION = 1;

/**
 * Frozen KDF parameters that MUST appear on-disk for a v1 envelope. These are
 * advertised in the envelope's `kdf` block; parseEnvelope rejects any envelope
 * whose advertised values disagree with these constants. The intent is to
 * fail fast BEFORE deriveKek runs (which would otherwise spend the full
 * Argon2id memory budget on a tampered file).
 *
 * The values mirror crypto.js's KDF_PARAMS (memoryCost / hashLength) but use
 * the on-disk field names (memCost / hashLen) used in createVault().
 *
 * If you bump these values you MUST also bump VERSION and add a migration.
 */
const FROZEN_ENVELOPE_KDF = Object.freeze({
  alg: 'argon2id',
  memCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLen: 32,
});

/** Salt width written by createVault(). Enforced on parse — see parseEnvelope. */
const SALT_BYTES = 16;

/**
 * Canonical JSON: object keys sorted alphabetically at every level; arrays
 * preserve their input order. Primitives go through JSON.stringify.
 *
 * @param {*} value
 * @returns {string} canonical JSON string
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Serialize an envelope object to a UTF-8 Buffer of its canonical JSON.
 *
 * @param {object} obj
 * @returns {Buffer}
 */
function serializeEnvelope(obj) {
  return Buffer.from(canonicalJson(obj), 'utf8');
}

/**
 * Parse a vault envelope buffer and validate magic + version. Throws
 * VaultIntegrityError on either mismatch — these checks fire BEFORE any AEAD
 * attempt to give the caller a clean "this isn't our format" error instead of
 * an opaque crypto failure.
 *
 * @param {Buffer|string} buf
 * @returns {object} parsed envelope
 */
function parseEnvelope(buf) {
  const str = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  let obj;
  try {
    obj = JSON.parse(str);
  } catch (err) {
    throw Object.assign(new VaultIntegrityError('vault: envelope is not valid JSON'), { cause: err });
  }
  if (!obj || typeof obj !== 'object') {
    throw new VaultIntegrityError('vault: envelope is not an object');
  }
  if (obj.magic !== MAGIC) {
    throw new VaultIntegrityError('vault: unrecognized format (magic mismatch)');
  }
  if (obj.version !== VERSION) {
    throw new VaultIntegrityError(`vault: format version ${obj.version} not supported`);
  }
  // WR-01: validate KDF params BEFORE the caller runs the expensive
  // deriveKek(). A tampered envelope that downgraded memCost/timeCost would
  // otherwise still consume the FROZEN crypto.js budget (because deriveKek
  // ignores envelope params), but the victim wouldn't learn the file was
  // bad until the HMAC check fired AFTER ~100ms of Argon2id work. Catching
  // the divergence here keeps the trust chain self-documenting and avoids
  // the DoS amplifier.
  if (!obj.kdf || typeof obj.kdf !== 'object') {
    throw new VaultIntegrityError('vault: missing kdf block');
  }
  for (const [k, v] of Object.entries(FROZEN_ENVELOPE_KDF)) {
    if (obj.kdf[k] !== v) {
      throw new VaultIntegrityError('vault: unsupported kdf parameters');
    }
  }
  if (typeof obj.kdf.salt !== 'string' || obj.kdf.salt.length === 0) {
    throw new VaultIntegrityError('vault: missing kdf salt');
  }
  // Salt WIDTH, not just presence. "non-empty string" let a tampered salt of the
  // wrong length through to deriveKek, where argon2 rejects it with its own bare
  // Error ("Salt should have at least 8 bytes"). That error escaped openVault
  // unwrapped — a distinguishable outcome from the deliberately identical
  // wrong-password / tampered-file error, i.e. a salt oracle, and a leak of
  // argon2 internals this module is explicitly meant not to expose.
  //
  // Reuses the existing 'unsupported kdf parameters' message on purpose: a new
  // message would restore the very distinction being closed.
  if (Buffer.from(obj.kdf.salt, 'base64').length !== SALT_BYTES) {
    throw new VaultIntegrityError('vault: unsupported kdf parameters');
  }
  // Rollback counter (see index.js `seq`). Optional so a pre-seq vault still
  // opens; when present it must be a non-negative safe integer, because a
  // string or float would silently defeat the `<` comparison that detects a
  // rollback.
  if (obj.seq !== undefined) {
    if (!Number.isSafeInteger(obj.seq) || obj.seq < 0) {
      throw new VaultIntegrityError('vault: invalid sequence number');
    }
  }
  return obj;
}

/**
 * Compute the whole-file HMAC over the envelope minus the `fileHmac` field
 * itself. Uses HMAC-SHA256 with the supplied sub-key (derived from KEK via
 * HKDF — see crypto.hkdfFileHmacKey).
 *
 * Returns a base64 string so it round-trips cleanly through JSON.
 *
 * @param {object} envelope
 * @param {Buffer} hmacKey  32 bytes
 * @returns {string} base64-encoded HMAC
 */
function computeFileHmac(envelope, hmacKey) {
  const clone = { ...envelope };
  delete clone.fileHmac;
  const body = canonicalJson(clone);
  const h = crypto.createHmac('sha256', hmacKey);
  h.update(body, 'utf8');
  return h.digest('base64');
}

/**
 * Constant-time HMAC verification. Returns false (does NOT throw) on any
 * mismatch — caller decides what to do (typically throws VaultAuthError to
 * conceal whether mismatch was wrong-password vs tampered-file).
 *
 * @param {object} envelope
 * @param {Buffer} hmacKey  32 bytes
 * @returns {boolean}
 */
function verifyFileHmac(envelope, hmacKey) {
  if (typeof envelope.fileHmac !== 'string' || envelope.fileHmac.length === 0) {
    return false;
  }
  const expected = Buffer.from(computeFileHmac(envelope, hmacKey), 'base64');
  let actual;
  try {
    actual = Buffer.from(envelope.fileHmac, 'base64');
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  MAGIC,
  VERSION,
  SALT_BYTES,
  canonicalJson,
  serializeEnvelope,
  parseEnvelope,
  computeFileHmac,
  verifyFileHmac,
};
