'use strict';

/**
 * jitCredentialBroker — mints short-TTL, tool-bound credentials in place of the
 * static backend service key.
 *
 * The static key stops travelling on the wire and becomes an HMAC *signing* key
 * instead. The backend already holds it, so nothing new is provisioned and
 * rotation reuses the existing ROTATE_SERVICE_KEYS path.
 *
 * The `tool` claim is what makes a leaked credential near-useless: it is valid
 * for one tool, for seconds, and the backend rejects it for any other route.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const killSwitchService = require('./killSwitchService');

const ISSUER = 'bff-broker';

/** Seconds. Long enough for one hop, short enough that replay is pointless. */
const TTL_SECONDS = 30;

/** configStore stores these under the lowercased env-alias name. */
function signingSecretFor(keyName) {
  return configStore.getEffective(String(keyName || '').toLowerCase());
}

/**
 * Mint a credential bound to one tool and one short window.
 *
 * @param {{ keyName: string, tool: string, requester: string }} params
 * @returns {Promise<{ value: string, jti: string, expiresAt: number, ttlMs: number }>}
 * @throws when the requester is revoked, or the signing secret is unset
 */
async function mintCredential({ keyName, tool, requester }) {
  // Revocation, reusing the existing kill switch rather than inventing one.
  // Called through the module object (not a destructured reference) so a test
  // double installed on the module is always the one that runs.
  if (await killSwitchService.isAgentRevoked(requester)) {
    const err = new Error(`Refusing to mint: ${requester} is revoked`);
    err.code = 'requester_revoked';
    throw err;
  }

  const secret = signingSecretFor(keyName);
  if (!secret) {
    const err = new Error(`Refusing to mint: signing secret for ${keyName} is unset`);
    err.code = 'signing_secret_unset';
    throw err;
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TTL_SECONDS;
  const jti = crypto.randomBytes(16).toString('hex');

  const value = jwt.sign(
    { iss: ISSUER, sub: requester, tool, jti, iat, exp },
    secret,
    { algorithm: 'HS256' },
  );

  return { value, jti, expiresAt: exp * 1000, ttlMs: TTL_SECONDS * 1000 };
}

module.exports = { mintCredential, ISSUER, TTL_SECONDS };
