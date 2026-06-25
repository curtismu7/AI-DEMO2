'use strict';

/**
 * RFC 8693 Token Exchange — POST /as/token
 *
 * Handles subject-token-only, actor-token, and two-token exchanges.
 * Returns a delegated access token for the requested audience/scopes.
 *
 * Request (application/x-www-form-urlencoded):
 *   grant_type = "urn:ietf:params:oauth:grant-type:token-exchange"
 *   subject_token = ... (user's access token)
 *   subject_token_type = "urn:ietf:params:oauth:token-type:access_token"
 *   [actor_token = ...] (optional; agent CC token)
 *   [actor_token_type = "urn:ietf:params:oauth:token-type:access_token"]
 *   [client_id = ...] (optional)
 *   [client_secret = ...] (if using POST auth)
 *   audience = ... (target resource URI)
 *   scope = ... (space-separated scopes)
 *
 * Response:
 *   { access_token, token_type: "Bearer", expires_in, scope, [act] }
 */

const jwt = require('jsonwebtoken');

function randomId() {
  try { return require('crypto').randomUUID(); } catch { return `token-${Date.now()}`; }
}

function buildDelegatedToken(subjectToken, actorToken, audience, scopes) {
  // SECURITY: a real signing/verification secret MUST be configured. We do NOT
  // fall back to a public hardcoded key — the old `|| 'demo-secret-key'` default
  // let anyone who knew that string forge a subject token, have it accepted, and
  // mint a delegated token with arbitrary aud/scope/act. Fail closed instead,
  // mirroring routes/introspect.js. Sign and verify with HS256 only (no RS256 in
  // the algorithm set) to avoid algorithm-confusion with the symmetric secret.
  const tokenSecret = process.env.AUTHZ_JWT_SECRET || '';
  if (!tokenSecret) {
    const e = new Error('token exchange not configured: AUTHZ_JWT_SECRET is not set');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }

  // Verify and decode the subject token (user's token)
  let subClaim;
  try {
    const decoded = jwt.verify(subjectToken, tokenSecret, { algorithms: ['HS256'] });
    subClaim = decoded?.sub || 'unknown-user';
  } catch (err) {
    console.warn(`[TokenExchange] Subject token signature verification failed: ${err.message}`);
    throw new Error('Invalid subject token: signature verification failed');
  }

  // Verify and decode actor token if present
  let actClaim;
  if (actorToken) {
    try {
      const decoded = jwt.verify(actorToken, tokenSecret, { algorithms: ['HS256'] });
      actClaim = decoded?.sub || decoded?.client_id || 'unknown-actor';
    } catch (err) {
      console.warn(`[TokenExchange] Actor token signature verification failed: ${err.message}`);
      throw new Error('Invalid actor token: signature verification failed');
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresInSec = 3600; // 1 hour

  const payload = {
    iss: `http://localhost:9001`,
    sub: subClaim,
    aud: audience || 'unknown',
    exp: nowSec + expiresInSec,
    iat: nowSec,
    nbf: nowSec,
    jti: randomId(),
    scope: scopes || '',
    token_use: 'access',
  };

  // Add act claim if actor token was provided
  if (actClaim) {
    payload.act = { sub: actClaim };
  }

  // Sign with the same configured secret used to verify the inputs above.
  const token = jwt.sign(payload, tokenSecret, { algorithm: 'HS256' });

  return { token, expiresInSec, payload };
}

module.exports = async function tokenHandler(req, res) {
  const body = req.body || {};
  const grantType = body.grant_type;

  // Validate grant type
  if (grantType !== 'urn:ietf:params:oauth:grant-type:token-exchange') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Grant type ${grantType} is not supported. Use "urn:ietf:params:oauth:grant-type:token-exchange".`,
    });
  }

  const subjectToken = body.subject_token;
  const actorToken = body.actor_token || null;
  const audience = body.audience || body.resource || 'unknown';
  const scopes = body.scope || 'read';

  // Validate subject token
  if (!subjectToken) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'subject_token parameter is required',
    });
  }

  try {
    const { token, expiresInSec, payload } = buildDelegatedToken(subjectToken, actorToken, audience, scopes);

    console.log(`[AuthzServer/token] RFC 8693 exchange → sub=${payload.sub} aud=${audience} act=${payload.act?.sub || '(none)'} scopes="${scopes}"`);

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresInSec,
      scope: scopes,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') {
      console.error('[AuthzServer/token] CRITICAL: AUTHZ_JWT_SECRET not configured — refusing to mint tokens with a default key. Set AUTHZ_JWT_SECRET and restart.');
      return res.status(503).json({
        error: 'temporarily_unavailable',
        error_description: 'token exchange not configured: AUTHZ_JWT_SECRET is not set',
      });
    }
    console.error('[AuthzServer/token] Exchange failed:', err.message);
    return res.status(500).json({
      error: 'server_error',
      error_description: `Token exchange failed: ${err.message}`,
    });
  }
};
