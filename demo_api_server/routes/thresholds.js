// banking_api_server/routes/thresholds.js
// GET/POST /api/config/thresholds — demo controls for step-up threshold values
// Supports per-vertical overrides via ?vertical=<id> (GET) and vertical body field (POST)
'use strict';

const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const runtimeSettings = require('../config/runtimeSettings');
const { logEvent, EVENT_CATEGORIES } = require('../services/appEventService');
const { requireAdminOrUnconfigured } = require('./adminConfig');

// Single source of truth: the committed defaults live in configStore.FIELD_DEFS.
// Derive them here instead of re-hardcoding 250/500 so the two can't drift. Guard
// the module-load read so a partial configStore (e.g. a test mock without
// FIELD_DEFS) can't crash this file at require time; fall back to the same values.
const DEFAULT_CONFIRM = Number(configStore.FIELD_DEFS?.confirm_threshold_usd?.default ?? 250); // HITL consent threshold
const DEFAULT_MFA = Number(configStore.FIELD_DEFS?.mfa_threshold_usd?.default ?? 500);         // MFA step-up threshold

// Valid vertical IDs — prevents arbitrary key injection via the vertical param
const VALID_VERTICAL_RE = /^[a-z][a-z0-9-]*$/;

function readThresholds(verticalId) {
  const confirmRaw = configStore.getEffective('confirm_threshold_usd');
  const mfaRaw = configStore.getEffective('mfa_threshold_usd');
  const confirmN = Number(confirmRaw);
  const mfaN = Number(mfaRaw);
  // Prefer live runtimeSettings value (may have been updated since boot); fall back to configStore
  const rtStepUp = runtimeSettings.get('stepUpAmountThreshold');
  const effectiveStepUp = (rtStepUp > 0) ? rtStepUp : (mfaN > 0 ? mfaN : DEFAULT_MFA);

  const result = {
    confirm_threshold_usd: String((confirmRaw && !isNaN(confirmN) && confirmN > 0) ? confirmN : DEFAULT_CONFIRM),
    mfa_threshold_usd:     String((mfaRaw    && !isNaN(mfaN)    && mfaN > 0)    ? mfaN     : DEFAULT_MFA),
    step_up_amount_threshold: effectiveStepUp,
  };

  // Include per-vertical overrides if a vertical ID is provided
  if (verticalId && VALID_VERTICAL_RE.test(verticalId)) {
    const vConfirmRaw = configStore.getEffective(`confirm_threshold_usd_${verticalId}`);
    const vMfaRaw = configStore.getEffective(`mfa_threshold_usd_${verticalId}`);
    const vConfirmN = Number(vConfirmRaw);
    const vMfaN = Number(vMfaRaw);
    result.vertical = verticalId;
    result[`confirm_threshold_usd_${verticalId}`] = (vConfirmRaw && !isNaN(vConfirmN) && vConfirmN > 0) ? String(vConfirmN) : null;
    result[`mfa_threshold_usd_${verticalId}`] = (vMfaRaw && !isNaN(vMfaN) && vMfaN > 0) ? String(vMfaN) : null;
  }

  return result;
}

// GET /api/config/thresholds[?vertical=<id>]
router.get('/', (req, res) => {
  res.json(readThresholds(req.query.vertical));
});

// POST /api/config/thresholds  { confirm_threshold_usd?, mfa_threshold_usd?, vertical? }
// When vertical is provided, writes per-vertical overrides (confirm_threshold_usd_<id>, mfa_threshold_usd_<id>)
// instead of global keys. Global keys are written when vertical is absent.
router.post('/', requireAdminOrUnconfigured, async (req, res) => {
  try {
    const { confirm_threshold_usd, mfa_threshold_usd, vertical } = req.body || {};

    if (vertical !== undefined && !VALID_VERTICAL_RE.test(vertical)) {
      return res.status(400).json({ error: 'invalid_vertical', message: 'vertical must match [a-z][a-z0-9-]*' });
    }

    const update = {};
    const confirmKey = vertical ? `confirm_threshold_usd_${vertical}` : 'confirm_threshold_usd';
    const mfaKey = vertical ? `mfa_threshold_usd_${vertical}` : 'mfa_threshold_usd';

    if (confirm_threshold_usd !== undefined) {
      const n = Number(confirm_threshold_usd);
      if (isNaN(n) || n <= 0) return res.status(400).json({ error: 'invalid_confirm_threshold', message: 'confirm_threshold_usd must be a positive number' });
      update[confirmKey] = String(n);
      // Only mirror to simulated AS keys for global (non-vertical) updates —
      // the simulated AS has no vertical awareness and reads only the global keys.
      if (!vertical) update.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = String(n);
    }
    if (mfa_threshold_usd !== undefined) {
      const n = Number(mfa_threshold_usd);
      if (isNaN(n) || n <= 0) return res.status(400).json({ error: 'invalid_mfa_threshold', message: 'mfa_threshold_usd must be a positive number' });
      update[mfaKey] = String(n);
      if (!vertical) {
        update.step_up_amount_threshold = String(n);
        update.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = String(n);
        runtimeSettings.update({ stepUpAmountThreshold: n }, 'thresholds-api');
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'no_update', message: 'Provide confirm_threshold_usd or mfa_threshold_usd' });
    }

    await configStore.setConfig(update);
    const verticalLabel = vertical ? ` [${vertical}]` : '';
    logEvent(EVENT_CATEGORIES.THRESHOLD, 'info',
      `Thresholds updated${verticalLabel} — confirm=$${update[confirmKey] || '(unchanged)'} mfa=$${update[mfaKey] || '(unchanged)'}`,
      { tag: 'threshold/updated', metadata: update });
    res.json({ ok: true, ...readThresholds(vertical) });
  } catch (err) {
    console.error('[Thresholds] Error:', err.message);
    res.status(500).json({ error: 'save_failed', message: err.message });
  }
});

module.exports = router;
