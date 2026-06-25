'use strict';
/**
 * sensitiveDataService.js
 *
 * Authorization gate for sensitive account data:
 *  1. Session consent token (60s TTL, userId-bound) — grants access within the window
 *  2. Scope check (sensitive:read or read)
 *  3. PAZ evaluation (FAIL_OPEN=false — deny if unreachable or unconfigured)
 */

const configStore = require('./configStore');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const simulatedAuthorizeService = require('./simulatedAuthorizeService');

const SESSION_KEY = 'sensitiveReadConsent';
const CONSENT_TTL_MS = 60 * 1000; // 60 seconds

// ─── PAZ evaluation helper ───────────────────────────────────────────────────

/**
 * Evaluate PAZ for sensitive data access.
 * FAIL_OPEN=false: deny when PAZ is unreachable or not configured.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ denied: boolean, reason?: string }>}
 */
async function evaluateSensitiveDataPaz(req) {
  const flag =
    configStore.get('ff_authorize_mcp_first_tool') === true ||
    configStore.get('ff_authorize_mcp_first_tool') === 'true';

  if (!flag) {
    // PAZ gate feature flag is off — permit
    return { denied: false };
  }

  const USE_SIMULATED = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);

  if (USE_SIMULATED) {
    const result = await simulatedAuthorizeService.evaluateMcpFirstTool({
      userId: req.user && req.user.sub,
      toolName: 'get_sensitive_account_details',
      tokenAudience: '',
      actClientId: '',
      nestedActClientId: '',
      mcpResourceUri: configStore.get('mcp_resource_uri') || '',
      acr: req.session && req.session.user && req.session.user.acr,
    });
    if (result.decision === 'DENY') {
      return { denied: true, reason: 'paz_denied' };
    }
    return { denied: false };
  }

  // Live PAZ
  const ready = pingOneAuthorizeService.isMcpDelegationDecisionReady();
  if (!ready) {
    // FAIL_OPEN=false: PAZ not configured → deny
    return { denied: true, reason: 'paz_not_configured' };
  }

  try {
    const result = await pingOneAuthorizeService.evaluateMcpToolDelegation({
      userId: req.user && req.user.sub,
      toolName: 'get_sensitive_account_details',
      agentToken: null,
      userAcr: req.session && req.session.user && req.session.user.acr,
    });
    if (!result || result.decision === 'DENY') {
      return { denied: true, reason: 'paz_denied' };
    }
    return { denied: false };
  } catch (err) {
    // Live PAZ threw — FAIL_OPEN=false → deny
    console.warn('[sensitiveDataService] PAZ evaluation error (denying):', err.message);
    return { denied: true, reason: 'paz_error' };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether the request is authorised to receive sensitive account data.
 *
 * Gate order:
 *  1. Session consent token present and valid (60s TTL, userId bound)
 *  2. Scope check: token must contain 'sensitive:read' or 'read'
 *     → If missing AND no session consent, return consent_required
 *  3. PAZ decision (FAIL_OPEN=false)
 *
 * @param {import('express').Request} req
 * @returns {Promise<
 *   { allowed: true } |
 *   { allowed: false, consent_required: true, reason: string } |
 *   { allowed: false, denied: true, reason: string }
 * >}
 */
async function checkSensitiveAccess(req) {
  const userId = req.user && req.user.sub;
  if (!userId) {
    return { allowed: false, denied: true, reason: 'no_user' };
  }

  // 1. Check session consent
  const consent = req.session && req.session[SESSION_KEY];
  const consentValid =
    consent &&
    consent.userId === userId &&
    typeof consent.expiresAt === 'number' &&
    Date.now() < consent.expiresAt;

  // 2. Scope check (only required when no valid session consent)
  if (!consentValid) {
    const rawScope =
      (req.user.scope || req.user.scp || (Array.isArray(req.user.scopes) ? req.user.scopes.join(' ') : '') || '');
    const tokenScopes = String(rawScope).split(/\s+/);
    const hasScope =
      tokenScopes.includes('sensitive:read') ||
      tokenScopes.includes('read');
    if (!hasScope) {
      return {
        allowed: false,
        consent_required: true,
        reason: 'sensitive_data_access',
      };
    }
  }

  // 3. PAZ evaluation (FAIL_OPEN=false)
  try {
    const paz = await evaluateSensitiveDataPaz(req);
    if (paz.denied) {
      return { allowed: false, denied: true, reason: paz.reason || 'paz_denied' };
    }
  } catch (err) {
    console.error('[sensitiveDataService] Unexpected PAZ error:', err.message);
    return { allowed: false, denied: true, reason: 'paz_error' };
  }

  return { allowed: true };
}

/**
 * Grant the session consent token. Call this when the user clicks "Reveal".
 * Sets req.session.sensitiveReadConsent = { grantedAt, expiresAt, userId }.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ ok: true, expiresAt: string }>}
 */
async function grantSensitiveConsent(req) {
  const userId = req.user && req.user.sub;
  if (!userId) {
    throw new Error('No authenticated user');
  }
  const now = Date.now();
  const expiresAt = now + CONSENT_TTL_MS;
  req.session[SESSION_KEY] = { grantedAt: now, expiresAt, userId };
  return { ok: true, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * Revoke the session consent token immediately (user clicked "Deny").
 *
 * @param {import('express').Request} req
 */
function revokeSensitiveConsent(req) {
  if (req.session) {
    delete req.session[SESSION_KEY];
  }
}

module.exports = {
  checkSensitiveAccess,
  grantSensitiveConsent,
  revokeSensitiveConsent,
};
