'use strict';

/**
 * Attack Simulator Route — A6.1
 *
 * POST /api/demo/attack-sim/run
 *
 * Gating (belt and suspenders):
 *   1. NODE_ENV === 'production' → 403 not_available_in_production  (hard guard)
 *   2. ff_use_cases_launcher flag disabled → 403 feature_disabled    (soft guard)
 *   3. authenticateToken middleware → 401 if no valid session
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { runAttackSim } = require('../services/attackSimulatorService');

const VALID_SIMS = ['insufficient-scope', 'wrong-aud', 'rate-limit-burst'];

router.post('/run', authenticateToken, async (req, res) => {
  // Hard production guard — this endpoint must never be reachable in prod.
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'not_available_in_production' });
  }

  // Soft feature-flag guard — launcher must be enabled.
  // getEffective() returns flag values as strings ('true'/'false'), never booleans,
  // so this must compare against the string 'false' — '=== false' never matched.
  if (configStore.getEffective('ff_use_cases_launcher') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }

  const { sim } = req.body || {};
  if (!VALID_SIMS.includes(sim)) {
    return res.status(400).json({ error: 'unknown_sim', validSims: VALID_SIMS });
  }

  try {
    const result = await runAttackSim(sim, req);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[attackSimulator] runAttackSim failed:', err.message);
    return res.status(500).json({ error: 'sim_execution_failed', message: err.message });
  }
});

module.exports = router;
