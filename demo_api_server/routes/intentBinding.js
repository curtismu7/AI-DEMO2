'use strict';

/**
 * Intent Binding Demo Route
 *
 * POST /api/demo/intent-binding/run
 * Body: { action: 'permit'|'drift', requestedAmount?: number, live?: boolean }
 *
 * Gating mirrors routes/attackSimulator.js: production hard guard, launcher
 * soft guard, session auth.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { runIntentBindingDemo } = require('../services/attackSimulatorService');
const { pushAuthorizationRequestWithRedirectFallback, isParRedirectUriMismatch } = require('../services/parService');
const { getParEndpoint } = require('../services/oauthEndpointResolver');
const { listActorParRedirectCandidates } = require('../services/oauthRedirectUris');

/** Classify PingOne PAR push failures for the learning-page token chain. */
function classifyParPushError(message) {
  const msg = String(message || '');
  if (isParRedirectUriMismatch(msg)) {
    return {
      errorCode: 'par_redirect_uri_mismatch',
      reason:
        `${msg} — register every PUBLIC_APP_URL host on Demo AI App AI Agent Actor ` +
        '(local.ping-devops.com + api.ping.demo + ai-demo.ping-devops.com). Re-run PingOne provision or Admin → Applications → AI Agent Actor → Redirect URIs.',
    };
  }
  return { errorCode: 'par_push_failed', reason: msg };
}

/**
 * Execute a transfer whose intent is declared via RAR authorization_details
 * (RFC 9396) — PingOne Authorize evaluates the requested amount against the
 * agent's declared $100 intent cap and returns PERMIT or DENY.
 *
 * @flow rar
 * @name RAR
 * @rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396
 * @why RAR (Rich Authorization Requests) replaces coarse scopes with structured authorization_details — type, amount, account, action — so the authorization server grants exactly one described transaction, and policy can enforce the difference between what was asked and what was granted.
 * @example Instead of a token with a broad payments scope, the token says "one transfer, up to $100, from checking, to this payee". A $2,000 transfer attempt with that token is denied by policy, not by hoping the client behaves.
 * @ai The agent declares its intent up front in machine-checkable form. Here PingOne Authorize compares the amount the agent actually requests against its declared $100 intent cap and returns PERMIT or DENY — overreach is caught at the policy layer.
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"action":"permit","requestedAmount":50,"live":false}
 */
router.post('/run', authenticateToken, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'not_available_in_production' });
  }

  if (configStore.getEffective('ff_use_cases_launcher') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }

  const { action, requestedAmount, live } = req.body || {};
  if (action !== 'permit' && action !== 'drift') {
    return res.status(400).json({ error: 'unknown_action', validActions: ['permit', 'drift'] });
  }

  // Live toggle: temporarily route the downstream PERMIT/DENY decision through
  // real PingOne Authorize for this call, mirroring the transient-flag-flip
  // pattern already used throughout attackSimulatorService.js (ff_rar,
  // requireRarIntent) rather than inventing new plumbing.
  // ff_authorize_real is a global, app-wide flag, so the prior value is
  // snapshotted and restored in `finally` below — a live:true run must only
  // affect this one call, not leave the app routed through real PingOne
  // Authorize afterward (success, failure, or a later live-unset request).
  let previousAuthorizeSimulated = null;
  if (live === true) {
    try {
      previousAuthorizeSimulated = configStore.getEffective('ff_authorize_real');
      await configStore.setRaw({ ff_authorize_real: 'true' });
    } catch (err) {
      console.error('[intentBinding] failed to arm live mode (non-fatal):', err.message);
    }
  }

  try {
    // PAR (RFC 9126) for live mode — Demo AI App AI Agent Actor (WEB), not the
    // Worker "Agent Actor". Endpoint/redirect derive from existing auth base +
    // public_app_url (same URI provision registers on the actor app).
    if (live === true) {
      const parEndpoint = getParEndpoint();
      const clientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
      const clientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');
      const redirectCandidates = listActorParRedirectCandidates();

      if (!parEndpoint || !clientId || !clientSecret || !redirectCandidates.length) {
        return res.status(503).json({
          error: 'par_config_missing',
          reason: 'PingOne PAR (RFC 9126) needs AI Agent Actor credentials plus pingone_environment_id (and ideally public_app_url). Configure: pingone_ai_agent_actor_client_id, pingone_ai_agent_actor_client_secret',
          tokenChainEvents: [{
            id: 'par-config-missing',
            label: 'PAR Configuration Missing',
            status: 'error',
          }],
        });
      }

      // Declared authority: the agent may transfer up to $100 (the intent pushed
      // to PAR). The push itself always succeeds — PingOne stores the request and
      // returns a request_uri without validating the amount — so intent binding
      // is enforced here by comparing the requested amount against the cap.
      const INTENT_CAP = 100;
      const amount = Number(requestedAmount) || 0;

      try {
        const authPayload = {
          scope: 'openid profile email',
          authorization_details: [{
            type: 'banking_transaction',
            actions: ['transfer'],
            amount,
            payee: 'acme-utilities',
          }],
        };

        // Prefer PUBLIC_APP_URL, then fall back across every known demo host so a
        // stale Actor allowlist (only api.ping.demo while the SPA is on
        // local.ping-devops.com) still completes the live demo.
        const parResult = await pushAuthorizationRequestWithRedirectFallback(
          parEndpoint,
          clientId,
          clientSecret,
          authPayload,
          redirectCandidates,
          'default',
        );

        const withinIntent = amount <= INTENT_CAP;
        const parPushEvents = [
          { id: 'par-push', label: 'PAR Endpoint Push', status: 'active' },
          { id: 'request-uri', label: 'Received request_uri', status: 'active' },
        ];
        if (parResult.usedFallback) {
          parPushEvents.push({
            id: 'par-redirect-fallback',
            label: `Redirect URI fallback → ${parResult.redirectUri}`,
            status: 'active',
          });
        }
        return res.status(200).json({
          sim: withinIntent ? 'par-permit' : 'par-deny',
          useCaseId: withinIntent ? 'par-intent-verified' : 'par-intent-violation',
          status: withinIntent ? 200 : 403,
          errorCode: withinIntent ? null : 'intent_exceeded',
          reason: withinIntent
            ? `PERMIT — $${amount} within the $${INTENT_CAP} declared intent (via PAR)`
            : `DENY — $${amount} exceeds the $${INTENT_CAP} declared intent (via PAR)`,
          requestUri: parResult.requestUri,
          redirectUri: parResult.redirectUri,
          tokenChainEvents: withinIntent
            ? [
                ...parPushEvents,
                { id: 'intent-check', label: `Intent cap $${amount} <= $${INTENT_CAP}`, status: 'active' },
                { id: 'p1az-permit', label: 'PingOne Authorize — PERMIT', status: 'active' },
              ]
            : [
                ...parPushEvents,
                { id: 'intent-check', label: `Intent cap $${amount} > $${INTENT_CAP}`, status: 'exceeded' },
                { id: 'transfer-blocked', label: 'Transfer blocked — intent exceeded', status: 'enforced' },
              ],
          live: true,
        });
      } catch (parErr) {
        console.error('[intentBinding] PAR push failed:', parErr.message);
        const classified = classifyParPushError(parErr.message);
        return res.status(200).json({
          sim: 'par-error',
          status: 403,
          errorCode: classified.errorCode,
          reason: classified.reason,
          tokenChainEvents: [
            { id: 'par-push', label: 'PAR Endpoint Push', status: 'error' },
          ],
          live: true,
        });
      }
    }

    const result = await runIntentBindingDemo(action, req, Number(requestedAmount));
    return res.status(200).json({ ...result, live: live === true });
  } catch (err) {
    console.error('[intentBinding] runIntentBindingDemo failed:', err.message);
    return res.status(500).json({ error: 'demo_execution_failed', message: err.message });
  } finally {
    if (live === true && previousAuthorizeSimulated !== null) {
      try {
        await configStore.setRaw({ ff_authorize_real: previousAuthorizeSimulated });
      } catch (err) {
        console.error('[intentBinding] failed to restore ff_authorize_real (non-fatal):', err.message);
      }
    }
  }
});

module.exports = router;
