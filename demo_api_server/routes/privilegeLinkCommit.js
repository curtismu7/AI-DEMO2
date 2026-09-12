'use strict';
/**
 * /internal/privilege-link/commit — the broker confirming that the browser which
 * finished the Privilege gateway sign-in is the one that started the authorize
 * (it checks its own browser-bound cookie first). Only then does the parked
 * token become the app's shared session.
 *
 * Same trust model as /internal/transaction-hop: NOT under /api/*, requires
 * x-internal-gateway-secret matching BFF_INTERNAL_SECRET, constant-time compare.
 */
const express = require('express');
const router = express.Router();
const { internalSecretMatches } = require('../utils/internalSecret');
const privilegeGatewaySession = require('../services/privilegeGatewaySession');

router.post('/privilege-link/commit', express.json({ limit: '4kb' }), (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rs = typeof req.body?.rs === 'string' ? req.body.rs : '';
  if (!rs) return res.status(400).json({ error: 'rs is required' });
  const committed = privilegeGatewaySession.commitPending(rs);
  if (!committed) return res.status(404).json({ error: 'no pending gateway session for that link' });
  return res.status(200).json({ app: committed.app });
});

module.exports = router;
