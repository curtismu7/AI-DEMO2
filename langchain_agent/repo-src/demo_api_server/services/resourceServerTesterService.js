'use strict';
/**
 * resourceServerTesterService — backend for the interactive Resource Server Tester
 * panel on the OIDC Resource Server page (/resource-server).
 *
 * Three modes:
 *   1. validate — real RS validation: JWKS signature (isolated as its own rule) +
 *                 per-rule aud / exp / nbf / scope checks → PERMIT | REJECT
 *   2. decode   — decode only (no signature), same policy rules → WOULD_PASS | WOULD_REJECT
 *   3. probe    — real server-side loopback HTTP call to a whitelisted protected path,
 *                 returning the actual status/body the resource server enforces.
 *
 * Security: callers are session-authenticated upstream (authenticateToken). The token
 * under test is supplied by reference (pulled from the session server-side, never shipped
 * to the browser) or pasted by the user. Raw tokens are never logged or persisted; the
 * route scrubs responses with scrubRawJwts as defense-in-depth.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const jwksService = require('./jwksService');
const tokenIntrospectionService = require('./tokenIntrospectionService');
const { getBffResourceAudience } = require('../config/resourceAudience');
// Required as a namespace and accessed at call time — destructuring at load time can
// capture `undefined` due to a require cycle through agentMcpTokenService.
const agentMcpTokenService = require('./agentMcpTokenService');

// The minimal scope this resource server requires (matches the banking read path).
const REQUIRED_SCOPE = 'read';

// Loopback probe targets. A FIXED whitelist — never an arbitrary URL — so the probe
// cannot be turned into an SSRF primitive.
const PROBE_WHITELIST = [
  '/api/resource-server/accounts',
  '/api/resource-server/transactions',
];

// Which session token fields the tester may reference. Only tokens that reliably exist
// in the user session — exchanged/external tokens are covered by the paste path.
const SESSION_TOKEN_REFS = { access: 'accessToken', id: 'idToken' };

/** Normalize a scope claim (space-delimited string or array) into an array. */
function scopesOf(claims) {
  const s = claims && claims.scope;
  if (Array.isArray(s)) return s;
  if (typeof s === 'string') return s.split(' ').filter(Boolean);
  return [];
}

/** Decode a JWT to { header, claims }, returning null if malformed. */
function safeDecode(token) {
  try {
    const d = agentMcpTokenService.decodeJwtClaims(token);
    return d && d.claims ? d : null;
  } catch (_) {
    return null;
  }
}

/**
 * The non-signature policy rules a resource server enforces, shared by validate and
 * decode. Each rule is { name, pass, detail } so the UI can render a breakdown.
 */
function policyRules(claims) {
  const now = Math.floor(Date.now() / 1000);
  const targetAud = getBffResourceAudience();
  const auds = claims.aud ? (Array.isArray(claims.aud) ? claims.aud : [claims.aud]) : [];
  const scopes = scopesOf(claims);
  const rules = [];

  // exp
  if (claims.exp) {
    const ok = claims.exp > now;
    rules.push({ name: 'exp', pass: ok, detail: ok ? `not expired (${claims.exp - now}s left)` : 'token expired' });
  } else {
    rules.push({ name: 'exp', pass: false, detail: 'no exp claim' });
  }

  // nbf (only when present)
  if (claims.nbf !== undefined) {
    const ok = claims.nbf <= now;
    rules.push({ name: 'nbf', pass: ok, detail: ok ? 'not-before satisfied' : `not valid for ${claims.nbf - now}s` });
  }

  // aud
  if (targetAud) {
    const ok = auds.includes(targetAud);
    rules.push({ name: 'aud', pass: ok, detail: ok ? `matches ${targetAud}` : `token aud=[${auds.join(', ') || 'none'}], RS expects ${targetAud}` });
  } else {
    rules.push({ name: 'aud', pass: false, detail: 'RS target audience not configured (PINGONE_RESOURCE_BFF_URI / ENDUSER_AUDIENCE)' });
  }

  // scope
  const hasScope = scopes.includes(REQUIRED_SCOPE);
  rules.push({ name: 'scope', pass: hasScope, detail: hasScope ? `has '${REQUIRED_SCOPE}'` : `missing '${REQUIRED_SCOPE}' (token scopes: ${scopes.join(' ') || 'none'})` });

  return rules;
}

/**
 * Opaque-token path for validate: a non-JWT (reference) token can't be decoded or
 * signature-checked locally, so ask the issuer via RFC 7662 introspection. The
 * "introspection" rule replaces "signature"; the same aud/exp/scope policy rules then run
 * on the introspected claims.
 */
async function introspectOpaque(token) {
  let intro;
  try {
    intro = await tokenIntrospectionService.validateToken(token);
  } catch (_) {
    intro = { valid: false, error: 'token_introspection_failed' };
  }
  if (intro.error) {
    return {
      error: 'introspection_unavailable',
      message: 'Token is opaque (not a JWT) and RFC 7662 introspection is not configured or failed, so its claims cannot be read. The live request probe can still test it.',
    };
  }
  const claims = {
    sub: intro.sub || undefined,
    aud: intro.aud || undefined,
    scope: Array.isArray(intro.scopes) ? intro.scopes.join(' ') : undefined,
    exp: intro.exp || undefined,
    iat: intro.iat || undefined,
    client_id: intro.client_id || undefined,
  };
  const rules = [
    { name: 'introspection', pass: !!intro.valid, detail: intro.valid ? 'PingOne reports the token is active (RFC 7662)' : 'PingOne reports the token is inactive or unknown' },
    ...policyRules(claims),
  ];
  const decision = rules.every((r) => r.pass) ? 'PERMIT' : 'REJECT';
  return { decision, rules, claims, method: 'introspection' };
}

/**
 * Mode 1: real RS validation. For a JWT, verifies the cryptographic signature against
 * PingOne JWKS first (isolated rule, so an expired-but-genuine token still shows
 * signature:pass), then evaluates the policy rules. For an opaque (non-JWT) token, falls
 * back to RFC 7662 introspection instead of the signature check.
 */
async function validate(token) {
  const decoded = safeDecode(token);
  if (!decoded) return introspectOpaque(token);
  const claims = decoded.claims;

  let sigPass = false;
  let sigDetail;
  try {
    const kid = decoded.header && decoded.header.kid;
    const key = await jwksService.getPublicKey(kid || null);
    if (!key) {
      sigDetail = 'JWKS unavailable (not configured or fetch failed)';
    } else {
      // ignoreExpiration so this rule reflects ONLY signature validity, not exp.
      jwt.verify(token, key.keyObject, { algorithms: [key.alg || 'RS256'], ignoreExpiration: true });
      sigPass = true;
      sigDetail = `verified against JWKS (kid=${kid || 'n/a'})`;
    }
  } catch (err) {
    sigDetail = `signature invalid: ${err.message}`;
  }

  const rules = [{ name: 'signature', pass: sigPass, detail: sigDetail }, ...policyRules(claims)];
  const decision = rules.every((r) => r.pass) ? 'PERMIT' : 'REJECT';
  return { decision, rules, claims };
}

/** Mode 2: decode + policy check (purely local — no signature, no network). */
function decode(token) {
  const decoded = safeDecode(token);
  // Decode is local-only by design; an opaque token has nothing to decode here. Point the
  // user at Real RS validation (which introspects opaque tokens) or the live probe.
  if (!decoded) return { error: 'malformed_token', message: 'Token is not a decodable JWT — it may be an opaque/reference token. Use "Real RS validation" (it introspects opaque tokens via RFC 7662) or the live request probe.' };
  const rules = policyRules(decoded.claims);
  const decision = rules.every((r) => r.pass) ? 'WOULD_PASS' : 'WOULD_REJECT';
  return { decision, rules, claims: decoded.claims };
}

// The loopback scheme is fixed for the process lifetime, so resolve it once at load.
// server.js sets BFF_LOOPBACK_SCHEME to the scheme it actually bound (the single source
// of truth); fall back to mirroring its cert detection if that hasn't been set.
const _loopbackScheme = (() => {
  if (process.env.BFF_LOOPBACK_SCHEME) return process.env.BFF_LOOPBACK_SCHEME;
  if (process.env.SSL_CRT_FILE && process.env.SSL_KEY_FILE) return 'https';
  const certDir = path.join(__dirname, '../../certs');
  const certPairs = [
    [path.join(certDir, 'api.ping.demo+2.pem'), path.join(certDir, 'api.ping.demo+2-key.pem')],
    [path.join(certDir, 'tls.crt'), path.join(certDir, 'tls.key')],
  ];
  return certPairs.some(([c, k]) => fs.existsSync(c) && fs.existsSync(k)) ? 'https' : 'http';
})();

// One agent for the process — a fresh one per probe would defeat connection pooling.
const _loopbackAgent = _loopbackScheme === 'https' ? new https.Agent({ rejectUnauthorized: false }) : undefined;

/** Keep only the response headers that explain an auth decision. */
function pickHeaders(h) {
  const keep = ['content-type', 'www-authenticate', 'x-oauth-error'];
  const out = {};
  for (const k of keep) if (h && h[k]) out[k] = h[k];
  return out;
}

/**
 * Mode 3: live request probe. Makes a real server-side HTTP call to a whitelisted
 * protected path with the token as the bearer, faithfully exercising authenticateToken.
 * Any HTTP status is a RESULT (not an error); only transport failures throw.
 */
async function probe(token, targetPath) {
  if (!PROBE_WHITELIST.includes(targetPath)) {
    return { error: 'invalid_target', message: `targetPath not allowed. Choose one of: ${PROBE_WHITELIST.join(', ')}` };
  }
  const port = process.env.PORT || 3001;
  const url = `${_loopbackScheme}://127.0.0.1:${port}${targetPath}`;
  try {
    const resp = await axios.get(url, {
      // Bearer only — deliberately no session cookie, so authenticateToken validates
      // the token under test rather than falling back to the caller's session.
      headers: { Authorization: `Bearer ${token}`, Host: 'api.ping.demo' },
      httpsAgent: _loopbackAgent,
      timeout: 8000,
      validateStatus: () => true,
    });
    return { status: resp.status, statusText: resp.statusText, headers: pickHeaders(resp.headers), body: resp.data };
  } catch (err) {
    return { error: 'probe_failed', message: `Loopback request failed: ${err.message}` };
  }
}

/**
 * Resolve the token under test. Prefers a pasted raw token; otherwise pulls the named
 * session token server-side. Returns { token, source } or { error }.
 */
function resolveToken({ tokenRef, tokenRaw }, session) {
  if (typeof tokenRaw === 'string' && tokenRaw.trim()) {
    return { token: tokenRaw.trim(), source: 'pasted' };
  }
  if (tokenRef) {
    const field = SESSION_TOKEN_REFS[tokenRef];
    if (!field) return { error: 'invalid_token_ref' };
    const tok = session && session.oauthTokens && session.oauthTokens[field];
    if (!tok || tok === '_cookie_session') return { error: 'token_not_in_session' };
    return { token: tok, source: `session:${tokenRef}` };
  }
  return { error: 'missing_token' };
}

// Human labels for the token currently under test, keyed by resolveToken's source value.
const REVEAL_LABELS = {
  pasted: 'Pasted JWT',
  'session:access': 'Session access token',
  'session:id': 'Session ID token',
  cc: 'Client Credentials token',
};

/**
 * Reveal the token under test: its human label, the RAW JWT, and decoded header + claims.
 * Unlike validate/decode/probe, this intentionally returns the raw token so the page can
 * show exactly which token it is evaluating — a deliberate exception to the module's
 * "claims only" custody rule, scoped to this teaching panel (tokens are shown on purpose).
 */
function reveal(token, source) {
  const decoded = safeDecode(token);
  if (!decoded) return { error: 'malformed_token', message: 'Token is not a decodable JWT.' };
  return {
    source,
    label: REVEAL_LABELS[source] || 'Token under test',
    token,
    header: decoded.header || null,
    claims: decoded.claims,
  };
}

module.exports = { validate, decode, probe, reveal, resolveToken, PROBE_WHITELIST };
