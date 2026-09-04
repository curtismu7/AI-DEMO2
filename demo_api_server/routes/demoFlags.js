'use strict';

const express = require('express');
const router = express.Router();

const { USE_CASES } = require('../config/useCases');
const { requiredFlagsForUseCaseId, isFlagOn } = require('../services/demoStepPrerequisites');
const configStore = require('../services/configStore');
const { pushEnterpriseMcpAuthToGateway } = require('./featureFlags');

/**
 * Guest-safe flag enable. The client names a use case, never a flag — the
 * server resolves which flags that use case needs via the same trusted
 * computation the signed-in chip-run auto-arm already uses
 * (routes/useCases.js), so this can never set a flag outside that resolved
 * set. No auth gate: mirrors GET /api/use-cases' openness — the reachable
 * flag set is bounded by requiredFlagsForUseCaseId regardless of caller.
 */
router.post('/enable', async (req, res) => {
  const { useCaseId } = req.body || {};
  if (!useCaseId || typeof useCaseId !== 'string') {
    return res.status(400).json({ error: 'useCaseId is required' });
  }

  const flags = requiredFlagsForUseCaseId(useCaseId, USE_CASES);
  if (flags.length === 0) {
    return res.status(404).json({ error: 'Unknown use case, or it needs no flags' });
  }

  for (const flag of flags) {
    try {
      if (!isFlagOn(configStore.getEffective(flag))) {
        await configStore.setRaw({ [flag]: 'true' });
        if (flag === 'ff_enterprise_managed_mcp_auth') {
          pushEnterpriseMcpAuthToGateway(true);
        }
      }
    } catch (err) {
      return res.status(500).json({ error: `failed to enable ${flag}: ${err.message}` });
    }
  }

  res.json({ success: true, flags });
});

/**
 * Guest-safe flag disable — mirrors /enable exactly, writing 'false' instead
 * of 'true'. Same bounding: the client names a use case, never a flag.
 */
router.post('/disable', async (req, res) => {
  const { useCaseId } = req.body || {};
  if (!useCaseId || typeof useCaseId !== 'string') {
    return res.status(400).json({ error: 'useCaseId is required' });
  }

  const flags = requiredFlagsForUseCaseId(useCaseId, USE_CASES);
  if (flags.length === 0) {
    return res.status(404).json({ error: 'Unknown use case, or it needs no flags' });
  }

  for (const flag of flags) {
    try {
      if (isFlagOn(configStore.getEffective(flag))) {
        await configStore.setRaw({ [flag]: 'false' });
        if (flag === 'ff_enterprise_managed_mcp_auth') {
          pushEnterpriseMcpAuthToGateway(false);
        }
      }
    } catch (err) {
      return res.status(500).json({ error: `failed to disable ${flag}: ${err.message}` });
    }
  }

  res.json({ success: true, flags });
});

module.exports = router;
