'use strict';

/**
 * idJagService.js — MCP client half of Enterprise-Managed Authorization.
 *
 * Requests an ID-JAG from the enterprise IdP, then redeems it at the MCP
 * Authorization Server for an access token. This is the Phase 3 path named in
 * planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md; the RFC 8693 stand-in remains
 * in place whenever native mode is unconfigured.
 *
 * @see docs/superpowers/specs/2026-08-22-enterprise-managed-mcp-authorization-design.md
 */

const axios = require('axios');
const crypto = require('crypto');
const configStore = require('./configStore');

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const cfg = (k) => String(configStore.getEffective(k) || '').trim();

/**
 * Native ID-JAG engages ONLY when both the enterprise IdP issuer and its JWKS
 * endpoint are configured. Either alone is a half-configured trust relationship
 * the MCP Authorization Server could not verify against, so it does not count.
 */
function isNativeIdJagEnabled() {
  return Boolean(cfg('enterprise_idp_issuer') && cfg('enterprise_idp_jwks_url'));
}

/**
 * The BFF's own enterprise-IdP endpoint (same process; loopback by default).
 *
 * https, not http: this server is mkcert-TLS-only on 3001 (same reason
 * ENTERPRISE_IDP_JWKS_URL in docker-compose.yml is https://). A plaintext HTTP
 * request against a TLS-only socket doesn't get a clean rejection — it hangs
 * up silently with zero response and zero server-side log line, surfacing
 * downstream only as an opaque "socket hang up" / ECONNRESET. Found live: the
 * native ID-JAG mint call failed this way even with policy PERMIT and native
 * mode fully configured; curl confirmed identical bytes over https:// return
 * the real 400 the route handler is supposed to send.
 */
function idpTokenUrl() {
  const base = cfg('enterprise_idp_base_url') || 'https://127.0.0.1:3001';
  return `${base}/api/enterprise-idp/token`;
}

/**
 * Rethrow an upstream OAuth error carrying the fields callers already branch on
 * (code, httpStatus), so a policy DENY stays distinguishable from a transport
 * failure all the way up to the agent path.
 */
function toDemoError(err, fallback) {
  const data = (err && err.response && err.response.data) || {};
  const wrapped = new Error(data.error_description || (err && err.message) || fallback);
  wrapped.code = data.code || data.error || 'id_jag_error';
  wrapped.httpStatus = (err && err.response && err.response.status) || 502;
  return wrapped;
}

/**
 * The /internal/agent-tool callback (routes/agentTool.js) resolves the
 * session server-side via sessionStore.get() and has no real HTTP headers to
 * forward — req.headers.cookie is empty there even though req.sessionID is
 * set. Re-sign a connect.sid value from that ID (express-session's own
 * cookie-signature format: 's:' + sessionID + '.' + hmac-sha256-base64) so
 * the loopback call authenticates exactly as the original browser request
 * would have.
 */
function cookieHeader(req) {
  if (req.headers && req.headers.cookie) return req.headers.cookie;
  if (!req.sessionID) return '';
  const secret = process.env.SESSION_SECRET || 'dev-session-secret-change-in-production';
  const mac = crypto.createHmac('sha256', secret).update(req.sessionID).digest('base64').replace(/=+$/, '');
  const signed = `s:${req.sessionID}.${mac}`;
  return `connect.sid=${encodeURIComponent(signed)}`;
}

/** Exchange the user's identity assertion for an ID-JAG scoped to one MCP server. */
async function mintIdJag(req, { audience, resource, scope }) {
  try {
    const { data } = await axios.post(
      idpTokenUrl(),
      {
        grant_type: TOKEN_EXCHANGE_GRANT,
        requested_token_type: ID_JAG_TOKEN_TYPE,
        subject_token: (req.session && (req.session.idToken || (req.session.user || {}).oauthId)) || '',
        subject_token_type: ID_TOKEN_TYPE,
        audience,
        resource,
        scope,
      },
      { headers: { Cookie: cookieHeader(req) }, timeout: 10000 },
    );
    return { assertion: data.access_token, expiresIn: data.expires_in };
  } catch (err) {
    throw toDemoError(err, 'ID-JAG mint failed.');
  }
}

/** Redeem an ID-JAG at the MCP Authorization Server for an access token. */
async function redeemIdJag(assertion) {
  try {
    const body = new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion,
      client_id: cfg('enterprise_mcp_as_client_id') || 'demo-bff-mcp-client',
    }).toString();
    const { data } = await axios.post(cfg('enterprise_mcp_as_token_url'), body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    throw toDemoError(err, 'ID-JAG redemption failed.');
  }
}

/**
 * Mint then redeem. A denied mint throws before any redemption is attempted —
 * the whole point of evaluating policy at the IdP is that no token exists to
 * present downstream.
 */
async function mintAndRedeem(req, { resource, scope }) {
  const audience = cfg('enterprise_mcp_as_issuer')
    || cfg('enterprise_mcp_as_token_url').replace(/\/token$/, '');
  const { assertion } = await mintIdJag(req, { audience, resource, scope });
  const token = await redeemIdJag(assertion);
  return { assertion, token };
}

module.exports = { isNativeIdJagEnabled, mintIdJag, redeemIdJag, mintAndRedeem };
