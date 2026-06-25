'use strict';
/**
 * sensitiveBanking.js
 *
 * Routes for sensitive account data disclosure:
 *   POST /api/accounts/sensitive-consent   — grant 60s session consent token
 *   GET  /api/accounts/sensitive-details   — return accountNumberFull + routingNumber
 *                                            (scope + PAZ + session consent required)
 *
 * Both routes are registered under /api/accounts in server.js and require
 * authenticateToken middleware applied at registration time.
 */

const router = require('express').Router();
const dataStore = require('../data/store');
const sensitiveDataService = require('../services/sensitiveDataService');
const runtimeSettings = require('../config/runtimeSettings');

/**
 * POST /api/accounts/sensitive-consent
 * Called by the UI when the user clicks "Reveal" in the SensitiveConsentBanner.
 * Grants a 60-second session consent token.
 * Requires: authenticateToken (applied at server.js registration).
 */
router.post('/sensitive-consent', async (req, res) => {
  try {
    const result = await sensitiveDataService.grantSensitiveConsent(req);
    // Force session flush before responding — ensures the sensitiveReadConsent flag
    // is written to the SQLite store BEFORE the subsequent /api/banking-agent/message
    // request reads the session (fixes race condition on async session save).
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );
    return res.json(result);
  } catch (err) {
    console.error('[sensitiveBanking] grantSensitiveConsent error:', err.message);
    return res.status(500).json({ error: 'Failed to grant consent', message: err.message });
  }
});

/**
 * GET /api/accounts/sensitive-details
 * Returns sensitive fields (accountNumberFull, routingNumber) for the authenticated
 * user's accounts.
 *
 * Gate: scope(sensitive:read OR read) + PAZ + session consent token.
 *
 * On gate failure:
 *   - Missing scope / consent → { ok: false, consent_required: true, reason: 'sensitive_data_access' }
 *   - PAZ denies              → { ok: false, denied: true, reason: 'paz_denied' | 'paz_error' | ... }
 *
 * On success:
 *   { ok: true, accounts: [{ id, accountType, name, accountNumber, accountNumberFull, routingNumber, swiftCode, iban }] }
 */
router.get('/sensitive-details', async (req, res) => {
  try {
    // ACR-based step-up gate: if user hasn't completed step-up auth, require it
    const userAcr = String(req.user?.acr || req.user?.['pingone:acr'] || '');
    const STEP_UP_ACR = runtimeSettings.get('stepUpAcrValue') || 'Multi_Factor';
    const hasElevatedAcr = userAcr === STEP_UP_ACR || userAcr.split(' ').includes(STEP_UP_ACR);

    if (!hasElevatedAcr) {
      const stepUpMethod = runtimeSettings.get('stepUpMethod') || 'email';
      return res.status(428).json({
        ok: false,
        step_up_required: true,
        error: 'step_up_required',
        step_up_method: stepUpMethod,
        step_up_acr: STEP_UP_ACR,
      });
    }

    const check = await sensitiveDataService.checkSensitiveAccess(req);

    if (!check.allowed) {
      if (check.consent_required) {
        return res.status(403).json({
          ok: false,
          consent_required: true,
          reason: check.reason || 'sensitive_data_access',
        });
      }
      return res.status(403).json({
        ok: false,
        denied: true,
        reason: check.reason || 'paz_denied',
      });
    }

    const userId = req.user.sub;
    const accounts = dataStore.getAccountsByUserId(userId);

    const sensitiveAccounts = accounts.map((account) => ({
      id: account.id,
      accountType: account.accountType,
      name: account.name,
      accountNumber: account.accountNumber,          // masked ****XXXX
      accountNumberFull: account.accountNumberFull,  // full 12-digit — exposed here only
      routingNumber: account.routingNumber,           // exposed here only
      swiftCode: account.swiftCode,
      iban: account.iban,
    }));

    return res.json({ ok: true, accounts: sensitiveAccounts });
  } catch (err) {
    console.error('[sensitiveBanking] sensitive-details error:', err.message);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

module.exports = router;
