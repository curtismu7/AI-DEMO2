'use strict';

/**
 * Agent Card signing (A2A v1.0 §8.4) — JWS over the SDK's RFC 8785
 * canonicalization, with an Ed25519 key of our own.
 *
 * The key is process-wide and regenerated on restart. That is sound here
 * because the same process serves both the cards and the JWKS; a persistent key
 * matters only once third parties cache our cards (see TECH_DEBT).
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

let _key = null;
const _signed = new Map();

/** Process-wide Ed25519 card-signing key. Separate from the Web Bot Auth key: one key, one purpose. */
function getCardSigningKey() {
  if (!_key) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x }
    _key = { privateKey, publicKey, publicJwk, kid: jwkThumbprint(publicJwk) };
  }
  return _key;
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
  if (_signed.has(vertical)) return _signed.get(vertical);
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
  _signed.set(vertical, signed);
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

module.exports = {
  getCardSigningKey,
  publicJwks,
  getSignedCard,
  cardVerifier,
  jwksUrl,
  _resetSignedCards,
};
