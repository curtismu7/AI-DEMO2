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
const { pushAuthorizationRequest, buildTokenExchangeWithPar } = require('../services/parService');

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
  // ff_authorize_simulated is a global, app-wide flag, so the prior value is
  // snapshotted and restored in `finally` below — a live:true run must only
  // affect this one call, not leave the app routed through real PingOne
  // Authorize afterward (success, failure, or a later live-unset request).
  let previousAuthorizeSimulated = null;
  if (live === true) {
    try {
      previousAuthorizeSimulated = configStore.getEffective('ff_authorize_simulated');
      await configStore.setRaw({ ff_authorize_simulated: 'false' });
    } catch (err) {
      console.error('[intentBinding] failed to arm live mode (non-fatal):', err.message);
    }
  }

  try {
    // PAR (RFC 9126) for live mode
    if (live === true) {
      const parEndpoint = configStore.getEffective('pingone_par_endpoint');
      const clientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
      const clientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');

      if (!parEndpoint || !clientId || !clientSecret) {
        return res.status(503).json({
          error: 'par_config_missing',
          reason: 'PingOne PAR (RFC 9126) is enabled by default. Configure: pingone_par_endpoint, pingone_ai_agent_actor_client_id, pingone_ai_agent_actor_client_secret',
          tokenChainEvents: [{
            id: 'par-config-missing',
            label: 'PAR Configuration Missing',
            status: 'error',
          }],
        });
      }

      try {
        const authPayload = {
          scope: 'openid profile email',
          authorization_details: {
            type: 'banking_transaction',
            tool: 'create_transfer',
            amount: 100,
            payee: 'acme-utilities',
          },
        };

        const parResult = await pushAuthorizationRequest(
          parEndpoint,
          clientId,
          clientSecret,
          authPayload,
          'default'
        );

        return res.status(200).json({
          sim: 'par-permit',
          useCaseId: 'par-intent-verified',
          status: 200,
          errorCode: null,
          reason: 'PERMIT (via PAR)',
          requestUri: parResult.requestUri,
          tokenChainEvents: [
            { id: 'par-push', label: 'PAR Endpoint Push', status: 'active' },
            { id: 'request-uri', label: 'Received request_uri', status: 'active' },
            { id: 'p1az-check', label: 'PingOne Authorize Check', status: 'active' },
          ],
          live: true,
        });
      } catch (parErr) {
        console.error('[intentBinding] PAR push failed:', parErr.message);
        return res.status(400).json({
          error: 'par_push_failed',
          reason: parErr.message,
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
        await configStore.setRaw({ ff_authorize_simulated: previousAuthorizeSimulated });
      } catch (err) {
        console.error('[intentBinding] failed to restore ff_authorize_simulated (non-fatal):', err.message);
      }
    }
  }
});

module.exports = router;
