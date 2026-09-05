'use strict';

/**
 * The façade's upstream leg to PingOne's hosted admin MCP server.
 *
 * WHY THIS EXISTS. The hosted server at mcp.pingone.{region}/admin/{envId}/mcp
 * accepts ONLY a delegated Authorization Code + PKCE token minted for its own
 * resource (see services/mcpPingOneHttpAdapter.js's header — a worker token is
 * an invalid credential there, not a weaker one). That token can only come from
 * a human completing a browser sign-in at /api/mcp/inspector/pingone-admin.
 *
 * For the demo's own client page that is fine: it forwards the browser's token
 * to the door as `x-pingone-admin-token`. An EXTERNAL MCP client has no such
 * header and no way to obtain one, so before this module the pingone-admin door
 * was usable from one page and nowhere else.
 *
 * This module carries the token a human already established so the door can
 * serve callers that have no browser session — the same shape as
 * services/privilegeGatewaySession.js does for the Privilege AI Gateway leg.
 *
 * THE TRADE, STATED PLAINLY. Every caller served from here acts as the human
 * who last signed in — PingOne admin tooling, at that human's roles. Per-user
 * distinction is lost for those callers, which is why the door pairs this with
 * `requireBearer`: an anonymous caller must never reach it. A caller that
 * supplies its own `x-pingone-admin-token` still acts as itself and never
 * touches this store.
 *
 * NO REFRESH. The sign-in requests `scope: 'openid'` with no `offline_access`,
 * so PingOne returns no refresh token and this session simply expires (~1h).
 * Someone signs in again; there is nothing to renew. Deliberately in-memory:
 * an admin credential at rest would buy the demo nothing.
 *
 * PROCESS-LOCAL, so it assumes ONE BFF replica. Scale the BFF out without
 * request affinity and the callback can populate one process while a façade
 * request lands on another, which reports `pingone_admin_login_required` even
 * though someone just signed in. The demo runs a single replica and
 * services/privilegeGatewaySession.js already carries the same assumption;
 * moving either to shared storage means putting a privileged token at rest,
 * which is a bigger decision than this store should make on its own.
 * ponytail: single shared session; key it per user if a second identity ever
 * needs this door.
 */

// Treat a token this close to expiry as already gone, so a call never races
// the clock mid-request.
const EXPIRY_SKEW_MS = 60_000;

/**
 * OFF unless a deployment opts in. The bearer the façade verifies is a generic
 * `mcp:invoke` token — any client that completes DCR against the broker holds
 * one — and nothing in it says "admin". So serving this store to that caller
 * hands ordinary broker users the operator's environment-wide PingOne admin
 * authority. That is the accepted trade for a demo, but it is not a safe
 * default for a deployment that never asked for it: unset, the door behaves as
 * it always did (browser-forwarded token only, 401 + loginUrl otherwise).
 *
 * Read per call, not captured at module load, so a test or a config change can
 * flip it without reloading the module.
 */
function sharedSessionEnabled() {
  return process.env.MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION === 'true';
}

let current = null;

/**
 * Record the delegated PKCE token a human just established.
 * Called from the authorization-code callback, alongside the browser session.
 */
function remember({ accessToken, expiresAt, expiresIn }) {
  if (!accessToken) return;
  const resolvedExpiry = Number(expiresAt) > 0
    ? Number(expiresAt)
    : Date.now() + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : 300_000);
  current = { accessToken, expiresAt: resolvedExpiry };
}

function clear() {
  current = null;
}

/** What the door reports when it cannot serve a request, for the operator. */
function status() {
  if (!sharedSessionEnabled()) return { ready: false, reason: 'disabled' };
  if (!current) return { ready: false, reason: 'no_session' };
  if (current.expiresAt - EXPIRY_SKEW_MS > Date.now()) return { ready: true };
  return { ready: false, reason: 'expired' };
}

/** The shared token, or null when a human needs to sign in again. */
function getAccessToken() {
  return status().ready ? current.accessToken : null;
}

module.exports = { remember, clear, status, getAccessToken, sharedSessionEnabled };
