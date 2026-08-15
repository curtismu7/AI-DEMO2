'use strict';
/**
 * /internal/transaction-hop — service-to-service hop ingest.
 *
 * Every instrumentable service ships one hop per phase of a transaction here,
 * fire-and-forget, so the BFF can assemble a complete chain of custody. Mirrors
 * the trust model of /internal/mcp-audit:
 *   - NOT mounted under /api/* (browser-facing prefix)
 *   - requires x-internal-gateway-secret matching BFF_INTERNAL_SECRET
 *   - constant-time secret comparison
 *
 * Status codes:
 *   204  accepted (no body)
 *   400  invalid_hop  — missing correlationId/service, or unknown phase
 *   403  forbidden    — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');
const { internalSecretMatches } = require('../utils/internalSecret');

const VALID_PHASES = new Set([
  'ui.request',
  'agent.reason',
  'token.exchange',
  'gateway.authorize',
  'authz.decision',
  'hitl.consent',
  'mcp.tool',
  'response',
]);

// The ledger is presented as an audit record, so raw credentials must never
// land in it — unlike teachLogger, where token visibility is a teaching
// feature. Claims and the jti survive; token values do not.
const TOKEN_KEYS = new Set([
  'access_token', 'refresh_token', 'id_token', 'subject_token', 'actor_token',
  'authorization', 'token', 'client_secret',
]);

function stripTokens(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (TOKEN_KEYS.has(k.toLowerCase())) continue;
    out[k] = v && typeof v === 'object' ? stripTokens(v, depth + 1) : v;
  }
  return out;
}

router.post('/transaction-hop', express.json({ limit: '64kb' }), (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.correlationId !== 'string' ||
    !body.correlationId ||
    typeof body.service !== 'string' ||
    !body.service ||
    !VALID_PHASES.has(body.phase)
  ) {
    return res.status(400).json({ error: 'invalid_hop' });
  }

  const { correlationId, ...hop } = body;
  try {
    ledger.appendHop(correlationId, stripTokens(hop));
  } catch (err) {
    // Auditing must never break a caller's request path — swallow and 204.
    // eslint-disable-next-line no-console
    console.warn('[transactionHopIngest] failed to persist hop:', err?.message);
  }
  return res.status(204).end();
});

module.exports = router;
