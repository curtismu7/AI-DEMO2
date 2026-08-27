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
const auditStore = require('./lmdb/mcpAuditStore.lmdb');

const ISSUER = 'bff-broker';

/** Seconds. Long enough for one hop, short enough that replay is pointless. */
const TTL_SECONDS = 30;

/** configStore stores these under the lowercased env-alias name. */
function signingSecretFor(keyName) {
  return configStore.getEffective(String(keyName || '').toLowerCase());
}

/**
 * Record an issuance (or a refusal) in the existing durable MCP audit store.
 *
 * Metadata ONLY — never the credential value or the secret it was signed with.
 * That store keeps 5000 events; writing a short-lived secret into it would give
 * the secret a long life, which is the opposite of the point.
 *
 * Fire-and-forget, matching gatewayAudit: losing an audit write must not take
 * out the request path it is observing.
 */
function recordIssuance(fields) {
  try {
    auditStore.append({ eventType: 'credential_issued', ...fields });
  } catch (err) {
    console.warn('[jitCredentialBroker] audit write failed:', err?.message);
  }
}

/**
 * Mint a credential bound to one backend route and one short window.
 *
 * @param {{ keyName: string, tool: string, aud: string, requester: string }} params
 *   aud — the backend route segment this credential is valid for (e.g. 'mortgage').
 *   tool — the MCP tool name, carried for audit/trace only; the backend gates on aud.
 * @returns {Promise<{ value: string, jti: string, expiresAt: number, ttlMs: number }>}
 * @throws when the route binding is missing, the requester is revoked, or the
 *   signing secret is unset
 */
async function mintCredential({ keyName, tool, aud, requester }) {
  // Single refusal path so no early return can skip the audit record. A refusal
  // is exactly the event worth having a trail for.
  const refuse = (code, message) => {
    recordIssuance({ outcome: 'refused', reason: code, keyName, tool, aud, requester });
    const err = new Error(message);
    err.code = code;
    return err;
  };

  // An unbound credential would be valid against every backend route, which
  // defeats the point. Refuse rather than mint one.
  if (!aud) {
    throw refuse('aud_required', 'Refusing to mint: no route binding (aud) supplied');
  }

  // Revocation, reusing the existing kill switch rather than inventing one.
  // Called through the module object (not a destructured reference) so a test
  // double installed on the module is always the one that runs.
  if (await killSwitchService.isAgentRevoked(requester)) {
    throw refuse('requester_revoked', `Refusing to mint: ${requester} is revoked`);
  }

  const secret = signingSecretFor(keyName);
  if (!secret) {
    throw refuse('signing_secret_unset', `Refusing to mint: signing secret for ${keyName} is unset`);
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TTL_SECONDS;
  const jti = crypto.randomBytes(16).toString('hex');

  const value = jwt.sign(
    { iss: ISSUER, sub: requester, aud, tool, jti, iat, exp },
    secret,
    { algorithm: 'HS256' },
  );

  // Metadata only — `value` is deliberately absent from the record.
  recordIssuance({
    outcome: 'success',
    keyName, tool, aud, requester, jti,
    ttlMs: TTL_SECONDS * 1000,
    expiresAt: exp * 1000,
  });

  return { value, jti, expiresAt: exp * 1000, ttlMs: TTL_SECONDS * 1000 };
}

module.exports = { mintCredential, ISSUER, TTL_SECONDS };
