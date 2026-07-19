'use strict';
/**
 * /internal/mcp-audit — gateway-only audit ingest endpoint
 *
 * The MCP gateway is the single chokepoint that sees every tool call across all
 * verticals (including direct agent-service -> gateway calls that never touch
 * the BFF). The gateway is stateless with no volume, so it ships each tool-call
 * outcome here, server-to-server, for durable persistence in the BFF's LMDB.
 *
 * Mirrors the trust model of /internal/id-token:
 *   - NOT mounted under /api/* (browser-facing prefix)
 *   - requires a shared secret (x-internal-gateway-secret) matching BFF_INTERNAL_SECRET
 *   - constant-time secret comparison
 *
 * Status codes:
 *   204  accepted (no body)
 *   400  invalid_event       — body is not a usable event object
 *   403  forbidden           — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const mcpAuditStore = require('../services/lmdb/mcpAuditStore.lmdb');

// Must match demo_mcp_gateway/src/config.ts DEFAULT_BFF_INTERNAL_SECRET and
// routes/agentIdToken.js. Production startup refuses this literal elsewhere.
const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

function _secretOk(presented) {
  const buf = typeof presented === 'string' ? Buffer.from(presented) : null;
  return (
    !!buf &&
    buf.length === INTERNAL_SECRET_BUF.length &&
    crypto.timingSafeEqual(buf, INTERNAL_SECRET_BUF)
  );
}

router.post('/mcp-audit', express.json(), (req, res) => {
  if (!_secretOk(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const ev = req.body;
  if (!ev || typeof ev !== 'object' || typeof ev.operation !== 'string') {
    return res.status(400).json({ error: 'invalid_event' });
  }
  try {
    mcpAuditStore.append({
      eventType: ev.eventType || 'tool_call',
      operation: ev.operation,
      outcome: ev.outcome || 'unknown',
      agentId: ev.agentId || null,
      userId: ev.userId || null,
      duration: Number.isFinite(ev.duration) ? ev.duration : null,
      vertical: ev.vertical || null,
      correlationId: ev.correlationId || null,
      details: ev.details && typeof ev.details === 'object' ? ev.details : {},
      timestamp: ev.timestamp,
    });
  } catch (err) {
    // Auditing must never break the gateway's request path — swallow and 204.
    // eslint-disable-next-line no-console
    console.warn('[mcpAuditIngest] failed to persist event:', err?.message);
  }
  return res.status(204).end();
});

module.exports = router;
