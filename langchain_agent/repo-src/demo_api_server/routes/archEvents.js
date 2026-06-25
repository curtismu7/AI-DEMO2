'use strict';

/**
 * GET /api/arch-events
 *
 * Server-Sent Events stream for the architecture simulation Live Trace mode.
 * Emits events of type 'arch-node' when real system activity occurs.
 *
 * Auth: session cookie (authenticateToken middleware applied at mount point).
 * Format: text/event-stream (standard SSE).
 *
 * Event format:
 *   event: arch-node
 *   data: {"nodeId":"n-bff","edgeId":"e-browser-bff","label":"OAuth callback received"}
 *
 * The BFF keeps the connection alive with a comment ping every 20 seconds.
 * Clients reconnect automatically via the EventSource API.
 */

const express = require('express');
const archEmit = require('../services/archEventEmitter');

const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders();

  // Send an initial connected event so the client knows the stream is live
  res.write('event: arch-connected\ndata: {"status":"connected"}\n\n');

  function onEvent({ nodeId, edgeId, label }) {
    const payload = JSON.stringify({ nodeId, edgeId: edgeId ?? null, label: label ?? null });
    res.write(`event: arch-node\ndata: ${payload}\n\n`);
  }

  archEmit.emitter.on('arch-node', onEvent);

  // Keep-alive ping every 20 s (prevents idle connection timeout)
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 20_000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    archEmit.emitter.off('arch-node', onEvent);
  });
});

module.exports = router;
