'use strict';

/**
 * Agent Card signing (A2A v1.0 §8.4) — JWS over the SDK's RFC 8785
 * canonicalization, with an Ed25519 key of our own.
 *
 * The key persists across restarts via the vault (TECH_DEBT.md 2026-09-11,
 * RESOLVED): `ensureCardSigningKeyPersisted()` runs once at boot (server.js,
 * in the same VAULT_PASSWORD-still-available window as the Helix key
 * migration — see there) and bridges the PEM into
 * process.env.A2A_CARD_SIGNING_PRIVATE_KEY, the same "vault value reaches a
 * plain env read" convention INTENT_TOKEN_SECRET and BFF_INTERNAL_SECRET
 * already use (vaultLoader's ENV_EXPORT_ALLOWLIST) — necessary because
 * VAULT_PASSWORD is deliberately wiped from process.env right after the
 * normal boot-time vault load, so getCardSigningKey() itself can never
 * reopen the vault at request time. No vault, or the boot step failing
 * non-fatally, falls back to the original ephemeral-per-process generation.
 *
 * `jose` is NOT imported: the SDK accepts a Node KeyObject, so this adds no
 * dependency.
 */

const crypto = require('node:crypto');
const {
  generateAgentCardSignature,
  verifyAgentCardSignature,
} = require('@a2a-js/sdk');
const { jwkThumbprint } = require('./dpopKeyService');
const { buildSpecialistAgentCard, publicApiBase } = require('./a2aAgentCardService');

const CARD_SIGNING_VAULT_KEY = 'A2A_CARD_SIGNING_PRIVATE_KEY';

let _key = null;
const _signed = new Map();

/** Derive the {privateKey, publicKey, publicJwk, kid} shape from a PKCS#8 PEM. */
function _keyFromPem(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x }
  return { privateKey, publicKey, publicJwk, kid: jwkThumbprint(publicJwk) };
}

function _generateKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  return { privateKey, publicKey, publicJwk, kid: jwkThumbprint(publicJwk) };
}

/**
 * Process-wide Ed25519 card-signing key. Separate from the Web Bot Auth key:
 * one key, one purpose. Never logs, prints, or returns raw key bytes to a
 * caller outside this module.
 */
function getCardSigningKey() {
  if (!_key) {
    const pem = process.env[CARD_SIGNING_VAULT_KEY];
    _key = pem ? _keyFromPem(pem) : _generateKey();
  }
  return _key;
}

/**
 * Boot-time only (mirrors helixKeyMigration.js's shape). Reads the persisted
 * card-signing key from the vault if one exists; otherwise generates a fresh
 * Ed25519 keypair exactly as getCardSigningKey()'s fallback always has,
 * persists it, then bridges the PEM into process.env so getCardSigningKey()
 * uses it for the rest of this process's life. Best-effort and non-fatal —
 * a vault problem here must never block startup or the card-signing fallback.
 *
 * Race note (accepted, pre-existing limitation — same class as every other
 * vault-backed secret this repo generates rather than requires an operator to
 * set): two processes racing this on a first boot can each generate a
 * different key; lib/vault's save() lost-update guard rejects the second
 * writer's save(), which this catches and logs, non-fatally — that process
 * then keeps its own unpersisted key for its own lifetime. Not solved here.
 *
 * @param {object} opts
 * @param {string} [opts.vaultPath]
 * @param {string} [opts.vaultPassword] required — no-ops without one
 * @param {object} [opts.vaultLib] DI seam for tests, default require('../lib/vault')
 * @param {object} [opts.logger] DI seam for tests, default console
 * @returns {Promise<{persisted: boolean, generated?: boolean, reason?: string}>}
 */
async function ensureCardSigningKeyPersisted(opts = {}) {
  const { vaultPath, vaultPassword } = opts;
  const vaultLib = opts.vaultLib || require('../lib/vault');
  const logger = opts.logger || console;

  if (!vaultPassword || !vaultPath) {
    return { persisted: false, reason: 'no_vault_password' };
  }

  let vault;
  try {
    vault = await vaultLib.openVault(vaultPath, vaultPassword, { caller: 'a2aCardSigningService' });
    const hasEntry = vault.list().includes(CARD_SIGNING_VAULT_KEY);
    let pem;
    let generated = false;
    if (hasEntry) {
      pem = vault.read(CARD_SIGNING_VAULT_KEY);
    } else {
      pem = _generateKey().privateKey.export({ format: 'pem', type: 'pkcs8' });
      vault.set(CARD_SIGNING_VAULT_KEY, pem);
      await vault.save();
      generated = true;
    }
    process.env[CARD_SIGNING_VAULT_KEY] = pem;
    return { persisted: true, generated };
  } catch (err) {
    // err.message only — never err.stack (could carry vault internals), and
    // never the pem/key material, which never appears in err.message here.
    logger.warn('[a2aCardSigningService] vault persistence skipped:', err.message);
    return { persisted: false, reason: 'vault_error' };
  } finally {
    try { if (vault) vault.close(); } catch (_) { /* ignore */ }
  }
}

/** JWKS document served next to the cards. */
function publicJwks() {
  const key = getCardSigningKey();
  return {
    keys: [{ ...key.publicJwk, kid: key.kid, use: 'sig', alg: 'EdDSA' }],
  };
}

/** Absolute URL of the JWKS document (also the `jku` we sign into the header). */
function jwksUrl(cfg) {
  return `${publicApiBase(cfg)}/a2a/specialists/.well-known/jwks.json`;
}

/**
 * Build and sign one specialist's Agent Card. Memoized per vertical — the card
 * is deterministic for a given key and config.
 * @returns {Promise<object|null>} signed card, or null when the vertical has no specialist
 */
async function getSignedCard(vertical, cfg) {
  // Keyed on jwksUrl(cfg) too, not just vertical: the card and the signed
  // jku both derive from cfg, so a config change (PUBLIC_APP_URL) must not
  // serve a stale jku memoized under an old cfg.
  const memoKey = `${vertical}|${jwksUrl(cfg)}`;
  if (_signed.has(memoKey)) return _signed.get(memoKey);
  const card = buildSpecialistAgentCard(vertical, cfg);
  if (!card) return null;
  const key = getCardSigningKey();
  const signer = generateAgentCardSignature(key.privateKey, {
    alg: 'EdDSA',
    kid: key.kid,
    typ: 'JOSE',
    jku: jwksUrl(cfg),
  });
  const signed = await signer(card);
  _signed.set(memoKey, signed);
  return signed;
}

/**
 * Verifier that trusts only OUR key: a `jku` from any other origin is refused
 * outright and never fetched, which blocks key substitution and SSRF.
 */
function cardVerifier(cfg) {
  const expectedJku = jwksUrl(cfg);
  return verifyAgentCardSignature(async (kid, jku) => {
    if (jku && String(jku) !== expectedJku) {
      throw new Error(`refusing foreign jku ${jku} (expected ${expectedJku})`);
    }
    const key = getCardSigningKey();
    if (kid !== key.kid) throw new Error(`unknown card-signing kid ${kid}`);
    return key.publicKey;
  });
}

/** Test seam: drop the memoized cards (e.g. after a config change). */
function _resetSignedCards() {
  _signed.clear();
}

/** Test seam: drop the memoized signing key so the next getCardSigningKey() re-derives it. */
function _resetCardSigningKey() {
  _key = null;
}

module.exports = {
  getCardSigningKey,
  ensureCardSigningKeyPersisted,
  publicJwks,
  getSignedCard,
  cardVerifier,
  jwksUrl,
  _resetSignedCards,
  _resetCardSigningKey,
  CARD_SIGNING_VAULT_KEY,
};
