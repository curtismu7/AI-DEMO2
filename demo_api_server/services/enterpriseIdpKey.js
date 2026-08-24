'use strict';

/**
 * enterpriseIdpKey.js
 * RS256 signing key for the demo Enterprise IdP that mints ID-JAG assertions.
 *
 * Deliberately NOT the private_key_jwt key from clientAssertionService: that one
 * is the BFF's identity as an OAuth *client* to PingOne. Signing IdP assertions
 * with it would conflate two trust roles, and it is often unconfigured.
 *
 * Mirrors oauth-mcp/src/oauth/SigningKeyManager.ts.
 */

const crypto = require('crypto');

let cached = null;

function build() {
  // A .env value can't hold real newlines, so a PEM stored there is commonly
  // \n-escaped on one line (e.g. "-----BEGIN...-----\nMIIEvQ...\n-----END...").
  // Only unescape when it looks escaped — a real multi-line PEM already
  // contains actual newlines and must pass through unchanged.
  const pemEnvRaw = process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM;
  const pemEnv = pemEnvRaw && !pemEnvRaw.includes('\n') ? pemEnvRaw.replace(/\\n/g, '\n') : pemEnvRaw;
  const privateKey = pemEnv
    ? crypto.createPrivateKey(pemEnv)
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

  const pem = pemEnv || privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const kid = crypto.createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0, 16);

  return { pem, jwk, kid };
}

function load() {
  if (!cached) cached = build();
  return cached;
}

function getPrivateKeyPem() { return load().pem; }
function getKid() { return load().kid; }

function getPublicJwk() {
  const { jwk, kid } = load();
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

/** Test-only: clears the memoised key so each test starts fresh. */
function resetForTests() { cached = null; }

module.exports = { getPrivateKeyPem, getPublicJwk, getKid, resetForTests };
