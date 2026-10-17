'use strict';

/**
 * routes/cibaLogin.js - passwordless sign-in over CIBA. Pre-authentication: no authenticateToken.
 *
 * POST /api/auth/ciba/login/start        { identifier, channel:'email'|'sms', role:'customer'|'admin' }
 *   -> 200 { authReqId, matchCode, expiresIn, interval } for EVERY well-formed request (real or decoy)
 * GET  /api/auth/ciba/login/poll/:id     -> 200 {status:'pending'} | 200 {status:'approved', redirectTo}
 *                                           | 410 {status:'expired'} | 403 {status:'denied'} | 404
 */

const express = require('express');
const router = express.Router();
const cibaLoginService = require('../services/cibaLoginService');

const CHANNELS = ['email', 'sms'];
const ROLES = ['customer', 'admin'];

router.post('/start', async (req, res) => {
  // JSON only: a cross-site <form> POST (urlencoded/multipart) must not be able to spray starts.
  if (!req.is('application/json')) return res.status(415).json({ error: 'unsupported_media_type' });
  const { identifier, channel, role } = req.body || {};
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 254
    || !CHANNELS.includes(channel) || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  try {
    return res.json(await cibaLoginService.startLogin({ identifier, channel, role, req }));
  } catch (err) {
    if (err instanceof cibaLoginService.RateLimitedError) {
      res.set('Retry-After', '600');
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (err instanceof cibaLoginService.ProviderUnsupportedError) return res.status(503).json({ error: 'provider_unsupported' });
    console.error('[cibaLogin] start error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/poll/:authReqId', async (req, res) => {
  const { authReqId } = req.params;
  if (!/^[0-9a-f]{48}$/.test(authReqId)) return res.status(404).json({ error: 'not_found' });
  try {
    const result = await cibaLoginService.pollLogin({ authReqId, req, res });
    if (result.status === 'notfound') return res.status(404).json({ error: 'not_found' });
    if (result.status === 'expired') return res.status(410).json({ status: 'expired' });
    if (result.status === 'denied') return res.status(403).json({ status: 'denied' });
    return res.json(result);
  } catch (err) {
    if (err instanceof cibaLoginService.ProviderUnsupportedError) return res.status(503).json({ error: 'provider_unsupported' });
    console.error('[cibaLogin] poll error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
