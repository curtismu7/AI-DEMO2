'use strict';

/**
 * routes/cibaLogin.js - CIBA second factor for a parked password flow (pre-session; the parked flow in the
 * session is the credential, so no authenticateToken).
 *
 * POST /api/auth/ciba/login/start        { channel:'email'|'sms' }
 *   -> 200 { authReqId, matchCode, expiresIn, interval } | 409 no_parked_flow | 400 channel_unavailable
 *      | 429 rate_limited | 502 approval_unavailable
 * GET  /api/auth/ciba/login/poll/:id     -> 200 {status:'pending'} | 200 {status:'approved', redirectTo}
 *                                           | 410 {status:'expired'} | 403 {status:'denied'} | 404
 */

const express = require('express');
const router = express.Router();
const svc = require('../services/cibaSecondFactorService');
const cibaLoginEnabled = require('../services/cibaLoginFlag');

const CHANNELS = ['email', 'sms'];

// Ships OFF. Checked before anything else and identical for every caller.
router.use((req, res, next) => (
  cibaLoginEnabled()
    ? next()
    : res.status(404).json({ error: 'ciba_login_disabled' })
));

router.post('/start', async (req, res) => {
  // JSON only: a cross-site <form> POST must not be able to spray starts.
  if (!req.is('application/json')) return res.status(415).json({ error: 'unsupported_media_type' });
  const { channel } = req.body || {};
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'invalid_request' });
  try {
    return res.json(await svc.startSecondFactor({ channel, req }));
  } catch (err) {
    if (err instanceof svc.NoParkedFlowError) return res.status(409).json({ error: 'no_parked_flow' });
    if (err instanceof svc.ChannelUnavailableError) return res.status(400).json({ error: 'channel_unavailable' });
    if (err instanceof svc.RateLimitedError) {
      res.set('Retry-After', '600');
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (err instanceof svc.ApprovalUnavailableError) return res.status(502).json({ error: 'approval_unavailable' });
    console.error('[cibaLogin] start error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/poll/:authReqId', async (req, res) => {
  const { authReqId } = req.params;
  if (!/^[0-9a-f]{48}$/.test(authReqId)) return res.status(404).json({ error: 'not_found' });
  try {
    const result = await svc.pollSecondFactor({ authReqId, req });
    if (result.status === 'notfound') return res.status(404).json({ error: 'not_found' });
    if (result.status === 'expired') return res.status(410).json({ status: 'expired' });
    if (result.status === 'denied') return res.status(403).json({ status: 'denied' });
    return res.json(result);
  } catch (err) {
    console.error('[cibaLogin] poll error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
