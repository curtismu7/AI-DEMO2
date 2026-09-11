'use strict';
/**
 * /internal/gateway-decision — PingGateway posts every P1AZ decision's audit trail
 * here (p1az-decision.groovy), so the gateway decisions panel on
 * /agent-gateway-inspector can show who called, with which token, and why
 * PingOne Authorize decided. It covers every caller, including
 * third-party apps such as Onyx that send no correlation id, which the
 * transaction ledger cannot record.
 *
 * Same trust model as /internal/transaction-hop:
 *   - NOT mounted under /api/* (browser-facing prefix)
 *   - requires x-internal-gateway-secret matching BFF_INTERNAL_SECRET
 *
 * Status codes:
 *   204  accepted (no body)
 *   400  invalid_trail — body is not an audit trail with an `authorize` block
 *   403  forbidden     — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const router = express.Router();
const agentGatewayDecisions = require('../services/agentGatewayDecisions');
const { internalSecretMatches } = require('../utils/internalSecret');

// The trail carries the full P1AZ request parameters and raw response, so it is
// larger than a transaction hop.
router.post('/gateway-decision', express.json({ limit: '256kb' }), (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const trail = req.body;
  if (!trail || typeof trail !== 'object' || !trail.authorize || typeof trail.authorize !== 'object') {
    return res.status(400).json({ error: 'invalid_trail' });
  }
  agentGatewayDecisions.record(trail);
  return res.status(204).end();
});

module.exports = router;
