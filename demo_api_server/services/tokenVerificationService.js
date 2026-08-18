/**
 * Cryptographic verification of JWTs using PingOne JWKS (RFC 7517 / RFC 7518).
 * When JWKS is unavailable, falls back to RFC 7662 active-token introspection
 * (asking PingOne directly instead of verifying the signature locally).
 *
 * Fail-open behaviour: by default a JWKS outage produces a warning and allows
 * the token to continue (demo-friendly).  Set JWKS_VERIFY_FAIL_OPEN=false to
 * hard-fail on signature-verification errors.
 *
 * RFC 7515 — JWS (signature structure)
 * RFC 7517 — JWK (key format)
 * RFC 7518 — JWA (algorithms)
 * RFC 7519 — JWT (claim semantics)
 * RFC 7662 — Token Introspection (fallback)
 */
'use strict';

const jwt = require('jsonwebtoken');
const jwksService = require('./jwksService');
const tokenIntrospectionService = require('./tokenIntrospectionService');
const oauthEndpointResolver = require('./oauthEndpointResolver');
const { logger, LOG_CATEGORIES } = require('../utils/logger');

/**
 * When true (default), JWKS unavailability or verification failure produces a
 * warning event instead of hard-failing the tool call.
 */
const FAIL_OPEN = process.env.JWKS_VERIFY_FAIL_OPEN !== 'false';

/**
 * Verify a JWT's RS256/RS384/RS512 signature using PingOne JWKS.
 * Falls back to RFC 7662 introspection when JWKS is unavailable — PingOne is
 * authoritative about tokens it just issued even without local sig verification.
 * Never throws — all outcomes returned as a result object.
 *
 * @param {string} token  Raw JWT string.
 * @returns {Promise<{
 *   verified: boolean,
 *   claims: object|null,
 *   alg: string|null,
 *   kid: string|null,
 *   warning: string|null,
 *   error: string|null,
 *   fallbackMethod: 'jwks'|'introspection'|'none'
 * }>}
 */

/**
 * Attempt RFC 7662 introspection as a fallback when JWKS is unavailable.
 * @param {string} token
 * @param {string|null} alg
 * @param {string|null} kid
 * @param {string} jwksFailureReason
 */
async function _introspectAsFallback(token, alg, kid, jwksFailureReason) {
  try {
    const intro = await tokenIntrospectionService.validateToken(token);
    if (intro.valid) {
      logger.info(LOG_CATEGORIES.AUTHENTICATION,
        `tokenVerificationService: JWKS unavailable — introspection fallback succeeded (sub=${intro.sub})`);
      return {
        verified: true,
        claims: { sub: intro.sub, exp: intro.exp, aud: intro.aud, scope: intro.scopes, client_id: intro.client_id },
        alg,
        kid,
        warning: `JWKS unavailable (${jwksFailureReason}); token confirmed active via RFC 7662 introspection. ` +
          'Cryptographic tamper-detection was skipped — PingOne confirmed liveness only.',
        error: null,
        fallbackMethod: 'introspection',
      };
    }
    // Introspection returned active=false — token is not valid
    const errorMsg = `JWKS unavailable and token inactive per RFC 7662 introspection`;
    if (FAIL_OPEN) {
      return { verified: false, claims: null, alg, kid, warning: errorMsg, error: null, fallbackMethod: 'introspection' };
    }
    return { verified: false, claims: null, alg, kid, error: errorMsg, warning: null, fallbackMethod: 'introspection' };
  } catch (introErr) {
    // "Introspection not configured" means the fallback was unavailable — the
    // check was SKIPPED, not that the token is inactive. Surface it as a warning
    // (never an error) so a valid exchanged token isn't rejected in fail-closed
    // mode just because introspection happens to be off. This is distinct from a
    // real introspection error (network/auth), which still honours FAIL_OPEN below.
    if (introErr.code === 'INTROSPECTION_NOT_CONFIGURED') {
      const warning = `JWKS unavailable (${jwksFailureReason}); introspection not configured — verification skipped.`;
      logger.warn(LOG_CATEGORIES.AUTHENTICATION,
        'tokenVerificationService: introspection fallback skipped — not configured');
      return { verified: false, claims: null, alg, kid, warning, error: null, fallbackMethod: 'none' };
    }
    logger.warn(LOG_CATEGORIES.AUTHENTICATION,
      `tokenVerificationService: introspection fallback also failed — ${introErr.message}`);
    const warning = `JWKS unavailable (${jwksFailureReason}); introspection fallback failed: ${introErr.message}`;
    if (FAIL_OPEN) {
      return { verified: false, claims: null, alg, kid, warning, error: null, fallbackMethod: 'none' };
    }
    return { verified: false, claims: null, alg, kid, error: warning, warning: null, fallbackMethod: 'none' };
  }
}
async function verifyExchangedToken(token) {
  if (!token || typeof token !== 'string') {
    return { verified: false, claims: null, alg: null, kid: null, error: 'no token provided', warning: null };
  }

  // --- Decode header (no cryptography yet) ---
  let header = null;
  try {
    const b64 = token.split('.')[0];
    // base64url → Buffer → string; Buffer.from handles both base64 and base64url
    header = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return { verified: false, claims: null, alg: null, kid: null, error: 'malformed JWT header', warning: null };
  }

  const kid = header?.kid || null;
  const alg = header?.alg || null;

  // Only handle asymmetric RS* algorithms (demo uses RS256)
  if (alg && !alg.startsWith('RS') && !alg.startsWith('PS') && !alg.startsWith('ES')) {
    const warning = `Algorithm ${alg} — symmetric or unknown; JWKS verification skipped`;
    return { verified: false, claims: null, alg, kid, warning, error: null };
  }

  // --- Lookup public key from JWKS ---
  let keyEntry = null;
  try {
    keyEntry = await jwksService.getPublicKey(kid);
  } catch (err) {
    logger.warn(LOG_CATEGORIES.AUTHENTICATION, `tokenVerificationService: JWKS lookup error — ${err.message}`);
  }

  if (!keyEntry) {
    return _introspectAsFallback(token, alg, kid, 'key not found in JWKS');
  }

  // --- Export crypto.KeyObject → PEM for jsonwebtoken ---
  let pem;
  try {
    pem = keyEntry.keyObject.export({ type: 'spki', format: 'pem' });
  } catch (err) {
    return _introspectAsFallback(token, alg, kid, `key export failed: ${err.message}`);
  }

  // --- Cryptographic verification ---
  //
  // RFC 7519 §4.1.1 — `iss` identifies the principal that issued the token, and
  // a verifier that skips it accepts a correctly-signed token from the wrong
  // issuer. Enforced by jsonwebtoken so the check cannot drift from the parse.
  //
  // Applied ONLY when an issuer is actually configured. getIssuer() falls back
  // to '' on an unconfigured environment, and passing '' would reject every
  // token — the demo runs unconfigured in places, and an empty expectation is
  // "unknown", not "must equal empty string". Same omission-means-unknown rule
  // the decision parameters follow.
  //
  // getIssuer() normalises the PingOne `/as` suffix, which is the exact
  // misconfiguration that once made every token fail with "jwt issuer invalid"
  // — that normalisation is why this can be turned on safely.
  const expectedIssuer = oauthEndpointResolver.getIssuer();
  try {
    const claims = jwt.verify(token, pem, {
      algorithms: [alg || keyEntry.alg || 'RS256'],
      complete: false,
      ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
    });

    logger.info(LOG_CATEGORIES.AUTHENTICATION, `tokenVerificationService: JWKS verified — kid=${kid || '(none)'} alg=${alg}`);
    return { verified: true, claims, alg, kid, warning: null, error: null, fallbackMethod: 'jwks' };
  } catch (err) {
    let errorMsg;
    if (err.name === 'TokenExpiredError') {
      errorMsg = `Token expired at ${new Date(err.expiredAt).toISOString()}`;
    } else if (err.name === 'JsonWebTokenError' && /jwt issuer invalid/i.test(err.message)) {
      // Distinct from a signature failure: the signature was fine, the token
      // came from somewhere else (or oauth_issuer is misconfigured — the
      // missing `/as` suffix is the classic case). Name both sides so the
      // cause is readable instead of surfacing as "signature invalid".
      errorMsg = `Issuer mismatch: token iss does not match the configured issuer (${expectedIssuer})`;
    } else if (err.name === 'JsonWebTokenError') {
      errorMsg = `Signature invalid: ${err.message}`;
    } else {
      errorMsg = `JWT verification failed: ${err.message}`;
    }

    logger.warn(LOG_CATEGORIES.AUTHENTICATION, `tokenVerificationService: ${errorMsg}`);

    // Signature verification failed — introspection won't help here (it can't
    // confirm integrity), so honour FAIL_OPEN directly without fallback.
    if (FAIL_OPEN) {
      return { verified: false, claims: null, alg, kid, warning: errorMsg, error: null, fallbackMethod: 'jwks' };
    }
    return { verified: false, claims: null, alg, kid, error: errorMsg, warning: null, fallbackMethod: 'jwks' };
  }
}

module.exports = { verifyExchangedToken };
