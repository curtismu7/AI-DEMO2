'use strict';
/**
 * /internal/id-token — gateway-only endpoint
 *
 * Returns the current user's id_token to the MCP Gateway server-to-server.
 * This is the ONLY place the raw id_token leaves the BFF. The endpoint:
 *   - is NOT mounted under /api/* (browser-facing prefix)
 *   - requires a shared secret (x-internal-gateway-secret) matching BFF_INTERNAL_SECRET
 *   - reads the id_token from the session store keyed by x-subject-sub
 *
 * The SPA NEVER calls this. CLAUDE.md "Token custody rule" applies.
 *
 * Status codes:
 *   200  { idToken: '<jwt>' }         — success
 *   400  missing_sub                  — x-subject-sub header absent
 *   403  forbidden                    — missing or wrong x-internal-gateway-secret
 *   404  session_not_found            — no session matched the subject sub
 *   412  id_token_missing             — session exists but no idToken (openid scope absent)
 *   503  session_store_unavailable    — memory-store fallback or store not registered
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// HI-03: audit-log every id_token retrieval so a compromised gateway
// scraping subs against the BFF leaves a forensic trail. Best-effort —
// failure to log must NEVER block the request path.
let _appEvents = null;
function _logIdTokenRetrieval(severity, message, metadata) {
  if (_appEvents === null) {
    try { _appEvents = require('../services/appEventService'); }
    catch (_) { _appEvents = false; }
  }
  if (_appEvents && typeof _appEvents.logEvent === 'function') {
    try { _appEvents.logEvent('oauth', severity, message, { tag: 'oauth/id-token', metadata }); }
    catch (_) { /* swallow — auditing must not affect the response */ }
  }
}

// HI-03: refuse to return id_tokens for sessions that haven't been touched
// recently. The default window matches the BFF's session activity timeout
// and lets ops widen / narrow it via env. Five minutes is tight enough to
// limit any single leaked-secret blast radius without disrupting active
// chat sessions.
const ID_TOKEN_MAX_SESSION_STALE_MS = Number(
  process.env.AGENT_ID_TOKEN_MAX_STALE_MS || 5 * 60 * 1000,
);

// BL-03: must match banking_mcp_gateway/src/config.ts DEFAULT_BFF_INTERNAL_SECRET.
// Production startup refuses this literal so the dev fallback can't ship.
const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

if (process.env.NODE_ENV === 'production' && INTERNAL_SECRET === DEFAULT_INTERNAL_SECRET) {
  // Fail-hard at module load: /internal/id-token would otherwise be open to
  // anyone who knows the public default secret. Symmetric with the gateway
  // assertion in banking_mcp_gateway/src/config.ts::assertProductionSecrets.
  // eslint-disable-next-line no-console
  console.error(
    '[BFF] FATAL: BFF_INTERNAL_SECRET is set to the committed dev default ' +
    `('${DEFAULT_INTERNAL_SECRET}') and NODE_ENV=production. ` +
    'Refusing to start. Set BFF_INTERNAL_SECRET to a unique 32+ byte secret.',
  );
  process.exit(1);
}

router.get('/id-token', (req, res) => {
  const presented = req.headers['x-internal-gateway-secret'];
  // Constant-time comparison — short-circuit equality leaks per-byte timing to an
  // attacker with network or SSRF access to the bound 0.0.0.0 interface.
  const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : null;
  if (
    !presentedBuf ||
    presentedBuf.length !== INTERNAL_SECRET_BUF.length ||
    !crypto.timingSafeEqual(presentedBuf, INTERNAL_SECRET_BUF)
  ) {
    _logIdTokenRetrieval('warn', 'id_token request rejected — bad internal secret', {
      remoteIp: req.ip,
      hasSubHeader: !!req.headers['x-subject-sub'],
    });
    return res.status(403).json({ error: 'forbidden' });
  }

  // The session is bound to a cookie the gateway doesn't have; the gateway
  // identifies the user via x-subject-sub from the validated MCP token.
  const sub = req.headers['x-subject-sub'];
  if (!sub) return res.status(400).json({ error: 'missing_sub' });

  // Optional correlation header from the gateway so a compromised-gateway
  // forensic trail can be reconstructed across services.
  const gatewayRequestId = req.headers['x-gateway-request-id'] || null;
  const requestedToolName = req.headers['x-tool-name'] || null;

  // Read the registered sessionStore. server.js calls app.set('sessionStore', sessionStore)
  // after instantiation (only when a real store is created; memory fallback does NOT
  // register, so we get undefined here and return 503 — graceful failure for fresh
  // installs that haven't migrated to a persistent store).
  const sessionStore = req.app.get('sessionStore');
  if (!sessionStore || typeof sessionStore.all !== 'function') {
    return res.status(503).json({ error: 'session_store_unavailable' });
  }

  // sessionStore.all(cb) signature: cb(err, sessions[]) where sessions is an
  // ARRAY of parsed session objects (deserialized by the store).
  //
  // W5 NOTE (performance): this enumerates EVERY session per gateway tool call.
  // For the Phase 266 demo (<100 sessions) the cost is negligible. For any realistic
  // scale, replace with a sub-indexed lookup (e.g., add a sub_index column to the
  // sqlite session schema and SELECT WHERE sub = ?). Deferred — out of scope for Phase 266.
  sessionStore.all((err, sessions) => {
    if (err) return res.status(500).json({ error: 'session_store_error' });
    const all = Array.isArray(sessions) ? sessions : (sessions ? Object.values(sessions) : []);
    const match = all.find((s) => {
      const tokens = s && s.oauthTokens;
      if (!tokens) return false;
      return tokens.subjectSub === sub || tokens.sub === sub;
    });
    if (!match) {
      _logIdTokenRetrieval('info', 'id_token request: no session matched sub', {
        sub, gatewayRequestId, toolName: requestedToolName,
      });
      return res.status(404).json({ error: 'session_not_found' });
    }
    // HI-03: refuse to surface id_tokens for stale sessions. The gateway
    // is supposed to be online and walking active users; an old session
    // pulled out of the store for a long-departed user is a defense-in-
    // depth concern when the shared secret is the only trust boundary.
    // We use oauthTokens.expiresAt as the freshness proxy because the
    // session cookie's maxAge is 24h regardless of activity.
    const tokens = match.oauthTokens;
    const expiresAt = tokens.expiresAt || 0;
    const ageMs = Date.now() - expiresAt;
    if (expiresAt && ageMs > ID_TOKEN_MAX_SESSION_STALE_MS) {
      _logIdTokenRetrieval('warn', 'id_token request rejected — session stale', {
        sub, gatewayRequestId, toolName: requestedToolName,
        accessTokenAgeMs: ageMs,
        maxStaleMs: ID_TOKEN_MAX_SESSION_STALE_MS,
      });
      return res.status(404).json({ error: 'session_not_found', reason: 'session_stale' });
    }
    const idToken = tokens.idToken;
    if (!idToken) {
      _logIdTokenRetrieval('info', 'id_token request: openid scope missing', {
        sub, gatewayRequestId, toolName: requestedToolName,
      });
      return res.status(412).json({ error: 'id_token_missing' });
    }
    _logIdTokenRetrieval('info', 'id_token returned to gateway', {
      sub, gatewayRequestId, toolName: requestedToolName,
    });
    return res.json({ idToken });
  });
});

module.exports = router;
