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
const axios = require('axios');
const spiffeActorToken = require('../spiffeActorToken');

/** RFC 8693 token type for a JWT-SVID presented as actor_token. */
const SVID_ACTOR_TYPE = 'urn:ietf:params:oauth:token-type:jwt';

/** Read per call, not at module load, so a test or a restart-free flip is seen. */
const spiffeActorEnabled = () => process.env.FF_SPIFFE_ACTOR_TOKEN === 'true';

function randomId() {
  try { return require('crypto').randomUUID(); } catch { return `token-${Date.now()}`; }
}

/**
 * Verify the inbound subject/actor tokens and extract their identity claims.
 * Split out from minting so a PingOne Authorize decision (see tokenHandler)
 * can be gated between verification and mint.
 */
function verifyExchangeTokens(subjectToken, actorToken) {
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

  return { subClaim, actClaim };
}

/**
 * Ask this server's own PingOne-Authorize-shaped decision endpoint (routes/decision.js,
 * DecisionContext='TokenExchange') whether the requested audience/scope may be minted.
 * Mirrors the real PingOne behavior of applying a policy decision as part of issuing
 * an exchanged token, using the same PERMIT/DENY engine every other authz path here
 * already goes through — instead of minting unconditionally on a valid signature alone.
 */
async function decideTokenExchange(subClaim, actClaim, audience, scopes) {
  const port = process.env.AUTHZ_PORT || 9001;
  const response = await axios.post(
    `http://localhost:${port}/governance/pap/alpha/policy/token-exchange/decision`,
    {
      parameters: {
        DecisionContext: 'TokenExchange',
        ClientId: subClaim,
        ActClientId: actClaim || '',
        RequestedAudience: audience || '',
        RequestedScope: scopes || '',
      },
    },
    { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
  );
  return response.data;
}

function mintExchangedToken(subClaim, actClaim, audience, scopes) {
  const tokenSecret = process.env.AUTHZ_JWT_SECRET;
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

  // ── JWT-SVID as actor_token (ff_spiffe_actor_token) ──────────────────────
  // Parity with PingFederate's JWT Token Processor 2.0: a SPIFFE workload
  // presents its SVID as the ACTOR, and the spiffe:// URI lands in act.sub so
  // the chain records which workload acted. PingOne cloud cannot do this — it
  // has no trusted-external-issuer object (docs/SPIFFE_PLAN.md), which is why
  // the behaviour lives in this parity mock.
  //
  // Verified against the SPIFFE trust bundle (RS256), NOT AUTHZ_JWT_SECRET.
  // Falling through to the HS256 path would try to verify an RS256 token with a
  // symmetric secret — it fails, but for the wrong reason and with a misleading
  // error, so the branch is explicit.
  let spiffeActClaim = null;
  if (actorToken && body.actor_token_type === SVID_ACTOR_TYPE) {
    if (!spiffeActorEnabled()) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `actor_token_type ${SVID_ACTOR_TYPE} is not enabled (ff_spiffe_actor_token is off)`,
      });
    }
    const svid = await spiffeActorToken.verifySvid(actorToken);
    if (!svid.valid) {
      console.warn(`[AuthzServer/token] SVID actor_token refused: ${svid.reason}`);
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: `actor_token is not a valid JWT-SVID: ${svid.reason}`,
      });
    }
    spiffeActClaim = svid.spiffeId;
  }

  // Validate subject token
  if (!subjectToken) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'subject_token parameter is required',
    });
  }

  let subClaim, actClaim;
  try {
    // A verified SVID supplies the actor itself, so the legacy HS256 actor path
    // is skipped for it — passing null keeps subject verification unchanged.
    ({ subClaim, actClaim } = verifyExchangeTokens(
      subjectToken,
      spiffeActClaim ? null : actorToken,
    ));
    if (spiffeActClaim) actClaim = spiffeActClaim;
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

  let decision;
  try {
    decision = await decideTokenExchange(subClaim, actClaim, audience, scopes);
  } catch (err) {
    console.error('[AuthzServer/token] PingOne Authorize decision call failed — failing closed:', err.message);
    return res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'token exchange policy is unavailable',
    });
  }
  if (decision?.decision !== 'PERMIT') {
    console.warn(`[AuthzServer/token] RFC 8693 exchange DENIED → sub=${subClaim} aud=${audience} scopes="${scopes}" reason=${decision?.reason || 'unknown'}`);
    return res.status(403).json({
      error: 'access_denied',
      error_description: decision?.reason || 'token exchange denied',
    });
  }

  try {
    const { token, expiresInSec, payload } = mintExchangedToken(subClaim, actClaim, audience, scopes);

    console.log(`[AuthzServer/token] RFC 8693 exchange → sub=${payload.sub} aud=${audience} act=${payload.act?.sub || '(none)'} scopes="${scopes}"`);

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresInSec,
      scope: scopes,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
  } catch (err) {
    console.error('[AuthzServer/token] Exchange failed:', err.message);
    return res.status(500).json({
      error: 'server_error',
      error_description: `Token exchange failed: ${err.message}`,
    });
  }
};
