'use strict';

/**
 * RFC 7662 Token Introspection — POST /as/introspect
 *
 * Validates an access token and returns its active state and claims.
 * If PINGONE_INTROSPECTION_ENDPOINT is set, forwards to real PingOne.
 * Otherwise performs local JWT decode + exp/aud validation.
 *
 * Request (application/x-www-form-urlencoded or JSON):
 *   token            — the bearer token to introspect
 *   token_type_hint  — optional, ignored
 *
 * Response (RFC 7662 §2.2):
 *   { active: true,  sub, scope, exp, client_id, aud, act, may_act, ... }
 *   { active: false }
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');

const UPSTREAM = process.env.PINGONE_INTROSPECTION_ENDPOINT || '';
// RFC 7662 requires the introspecting client to own the token's audience (issuing client).
// Prefer GW_INTROSPECTION_* (MCP Exchanger credentials) over the gateway client.
// Falling back to MCP_GW_CLIENT_ID causes PingOne to return active=false, rejecting valid tokens.
const UPSTREAM_CLIENT_ID = process.env.GW_INTROSPECTION_CLIENT_ID || process.env.MCP_GW_CLIENT_ID || '';
const UPSTREAM_CLIENT_SECRET = process.env.GW_INTROSPECTION_CLIENT_SECRET || process.env.MCP_GW_CLIENT_SECRET || '';
const UPSTREAM_AUTH_METHOD = (process.env.PINGONE_INTROSPECTION_AUTH_METHOD || 'basic').toLowerCase();
// When set, local path verifies JWT signatures with this secret/key.
// Without it, signatures are NOT verified — acceptable for isolated dev but not for shared envs.
const LOCAL_JWT_SECRET = process.env.AUTHZ_JWT_SECRET || '';

// A 401 from PingOne's /as/introspect always means the introspecting client's
// OWN credentials/auth-method were rejected (invalid_client) — PingOne never
// uses 401 to say the subject token is inactive (that's a 200 {active:false}).
// So a 401 is unambiguously a client auth-method misconfiguration, safe to
// retry once with the other method. Once one method is confirmed working,
// cache it so every later call goes straight there instead of re-failing the
// bad method first.
let workingAuthMethod = UPSTREAM_AUTH_METHOD;

function otherMethod(method) {
  return method === 'post' ? 'basic' : 'post';
}

function buildIntrospectionRequest(token, method) {
  const params = new URLSearchParams({ token, token_type_hint: 'access_token' });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (method === 'post') {
    params.set('client_id', UPSTREAM_CLIENT_ID);
    params.set('client_secret', UPSTREAM_CLIENT_SECRET);
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${UPSTREAM_CLIENT_ID}:${UPSTREAM_CLIENT_SECRET}`).toString('base64')}`;
  }
  return { params, headers };
}

module.exports = async function introspectHandler(req, res) {
  // Accept both JSON and form-encoded
  const token = req.body?.token || req.body?.access_token;

  if (!token) {
    return res.status(400).json({ error: 'token parameter required' });
  }

  // ── Option 1: Delegate to real PingOne ───────────────────────────────────
  if (UPSTREAM) {
    try {
      const { params, headers } = buildIntrospectionRequest(token, workingAuthMethod);
      const response = await axios.post(UPSTREAM, params.toString(), { headers, timeout: 5000 });
      console.log(`[AuthzServer/introspect] Upstream PingOne → active=${response.data?.active}`);
      return res.json(response.data);
    } catch (err) {
      if (err.response?.status === 401) {
        const fallback = otherMethod(workingAuthMethod);
        try {
          const { params, headers } = buildIntrospectionRequest(token, fallback);
          const response = await axios.post(UPSTREAM, params.toString(), { headers, timeout: 5000 });
          console.warn(`[AuthzServer/introspect] Configured auth method "${workingAuthMethod}" rejected (401) — "${fallback}" worked, switching to it for future calls`);
          workingAuthMethod = fallback;
          return res.json(response.data);
        } catch (fallbackErr) {
          console.warn(`[AuthzServer/introspect] Both auth methods rejected (401) — failing closed: ${fallbackErr.message}`);
          return res.json({ active: false, error: 'upstream_introspection_auth_error' });
        }
      }
      console.warn(`[AuthzServer/introspect] Upstream call failed (${err.message}) — failing closed`);
      return res.json({ active: false, error: 'upstream_introspection_failed' });
    }
  }

  // ── Option 2: Local JWT decode (dev mode, no upstream PingOne) ───────────
  try {
    let decoded;
    if (LOCAL_JWT_SECRET) {
      // Verify signature when a secret is configured. HS256 only: LOCAL_JWT_SECRET
      // is a symmetric secret, so allowing RS256 here invites algorithm-confusion.
      // Real RS256 PingOne tokens go through the upstream path above, not here.
      try {
        decoded = jwt.verify(token, LOCAL_JWT_SECRET, {algorithms: ['HS256']});
      } catch (verifyErr) {
        console.warn(`[AuthzServer/introspect] JWT signature verification failed: ${verifyErr.message}`);
        return res.json({ active: false });
      }
    } else {
      // No secret configured — FAIL CLOSED (do not decode without verification).
      console.error('[AuthzServer/introspect] CRITICAL: AUTHZ_JWT_SECRET not configured and PINGONE_INTROSPECTION_ENDPOINT not set. Token introspection REQUIRES either a configured JWT secret for signature verification or an upstream PingOne endpoint. Set PINGONE_INTROSPECTION_ENDPOINT or AUTHZ_JWT_SECRET and restart.');
      return res.json({ active: false, error: 'introspection_not_configured' });
    }

    if (!decoded) {
      return res.json({ active: false });
    }

    // Expiry check — RFC 7519 §4.1.4: token is expired when now >= exp
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && now >= decoded.exp) {
      console.log(`[AuthzServer/introspect] Token expired (exp=${decoded.exp}, now=${now})`);
      return res.json({ active: false });
    }

    const response = {
      active: true,
      sub: decoded.sub,
      scope: decoded.scope,
      exp: decoded.exp,
      iss: decoded.iss,   // RFC 7662 §2.2 SHOULD field; real PingOne always includes this
      nbf: decoded.nbf,   // RFC 7662 §2.2 SHOULD field
      aud: decoded.aud,
      client_id: decoded.client_id,  // OAuth client_id; do not fall back to sub (different identities)
      username: decoded.username || decoded.email,
      token_type: 'Bearer',
    };

    // Include delegation claims if present
    if (decoded.act)     response.act = decoded.act;
    if (decoded.may_act) response.may_act = decoded.may_act;

    console.log(`[AuthzServer/introspect] Local decode → active=true sub=${decoded.sub} act=${JSON.stringify(decoded.act)}`);
    return res.json(response);
  } catch (err) {
    console.warn(`[AuthzServer/introspect] Local decode failed: ${err.message}`);
    return res.json({ active: false });
  }
};
