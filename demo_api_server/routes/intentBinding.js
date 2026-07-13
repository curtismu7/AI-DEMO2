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
