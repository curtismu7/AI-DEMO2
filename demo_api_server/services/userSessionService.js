'use strict';

const tokenIntrospectionService = require('./tokenIntrospectionService');
const loginFlowTrace = require('./loginFlowTraceService');

/**
 * Build a signed-in user session (shared by the OAuth callback and any other login path).
 * Regenerates the session id (anti-fixation), stores tokens/user, runs enterprise MCP bootstrap
 * and login introspection, then saves. Never redirects and never touches cookies: the caller
 * owns the response and failure cleanup.
 *
 * `user` is the authed user object; `onRegenerated(session)` lets the caller stamp extra
 * session fields right after regenerate (hosted-access / ID-JAG state).
 * Returns { ok: true, oauthTokens } or { ok: false, reason }.
 */
async function establishUserSession(req, res, {
  tokenData, idTokenClaims, provider, clientType, loginTraceId, user, onRegenerated,
}) {
  // Pre-capture before regenerating the session to prevent session fixation
  const oauthTokens = {
    accessToken: tokenData.access_token,
    idToken: tokenData.id_token || null,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000),
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || null,
  };

  // Consent ACR and may_act, used by the consent gate in agentMcpTokenService and the agent UI.
  let accessTokenAcr = null;
  let accessTokenMayAct = null;
  try {
    const parts = (tokenData.access_token || '').split('.');
    if (parts.length === 3) {
      const atClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      accessTokenAcr = idTokenClaims.acr || null;
      accessTokenMayAct = atClaims.may_act || null;
    }
  } catch (_) { /* non-fatal — acr / may_act stay null */ }

  // Phase 266: cache subject sub so /internal/id-token can look up sessions by sub without the cookie.
  oauthTokens.subjectSub = idTokenClaims.sub || null;

  const regenErr = await new Promise((resolve) => req.session.regenerate((e) => resolve(e || null)));
  if (regenErr) {
    console.error('[userSession] Session regenerate FAILED — aborting login:', regenErr.message);
    return { ok: false, reason: 'session_regenerate_failed' };
  }

  req.session.oauthTokens = oauthTokens;
  req.session.user = user;
  req.session.clientType = clientType;
  req.session.oauthType = 'user';
  req.session.oauthProvider = provider;
  if (onRegenerated) onRegenerated(req.session);
  // D-01: clear pending agent intent — client handles replay via sessionStorage (BX_AGENT_PENDING_NL_KEY)
  delete req.session.pendingAgentIntent;

  loginFlowTrace.addStep(loginTraceId, {
    actor: 'bff',
    title: 'BFF regenerates the session and stores the tokens',
    detail: 'Session id is rotated (anti-fixation); tokens stored server-side; profile read from the ID token.',
    protocolDetail: [
      ['regenerate()', 'new session id'],
      ['sub', idTokenClaims.sub || 'unknown'],
    ],
  });

  console.log('[userSession] tokens stored — access_token=%s id_token=%s refresh_token=%s',
    oauthTokens.accessToken ? 'PRESENT' : 'MISSING',
    oauthTokens.idToken ? 'PRESENT' : 'MISSING',
    oauthTokens.refreshToken ? 'PRESENT' : 'MISSING');

  // Consent gate: stored so the MCP token-exchange guard needn't re-decode the JWT.
  req.session.consentAcr = accessTokenAcr;
  req.session.mayAct = accessTokenMayAct;

  // Enterprise-managed MCP: evaluate IT policy after SSO login (auto-connect when allowed).
  try {
    const enterpriseMcpPolicy = require('./enterpriseMcpPolicyService');
    if (enterpriseMcpPolicy.isEnabled()) await enterpriseMcpPolicy.establishEnterpriseSession(req);
  } catch (e) {
    console.warn('[userSession] enterprise MCP policy check skipped:', e.message);
  }

  // RFC 7662 — introspect at login (awaited, never throws) so the token chain shows it on first fetch.
  try {
    const loginIntrospection = await tokenIntrospectionService.introspectAtLogin(oauthTokens.accessToken);
    if (loginIntrospection) req.session.loginIntrospection = loginIntrospection;
  } catch (err) {
    console.debug('[userSession] loginIntrospection skipped:', err.message);
  }

  const saveErr = await new Promise((resolve) => req.session.save((e) => resolve(e || null)));
  if (saveErr) {
    console.error('[userSession] Session save FAILED — aborting login (no _auth cookie):', saveErr.message);
    return { ok: false, reason: 'session_persist_failed' };
  }
  return { ok: true, oauthTokens };
}

module.exports = { establishUserSession };
