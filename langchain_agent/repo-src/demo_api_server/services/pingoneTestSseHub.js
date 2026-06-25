'use strict';

/**
 * Session-keyed SSE hub for PingOne test page.
 *
 * Clients open GET /api/pingone-test/events to receive a stream of events as
 * tests run.  The route handlers and apiCallTrackerService call publish() to
 * push events to all connected subscribers for a given session.
 *
 * Event envelope:
 *   { type, t, ...payload }
 *
 * Types:
 *   "token"    — token acquired/failed  (id, label, status, decoded, error)
 *   "exchange" — token exchange result  (id, label, status, decoded, error)
 *   "api_call" — API call tracked       (method, url, status, duration, category)
 *   "ping"     — keepalive (no payload)
 */

/** @type {Map<string, Set<import('express').Response>>} sessionId → SSE responses */
const sessionSubscribers = new Map();

const KEEPALIVE_MS = 20_000;

/**
 * Open an SSE stream for a session.  Leaves res open; caller must NOT call
 * res.end() — the hub manages lifetime.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function attach(req, res) {
  const sessionId = req.sessionID || 'pingone-test';

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(': sse connected\n\n');

  let set = sessionSubscribers.get(sessionId);
  if (!set) { set = new Set(); sessionSubscribers.set(sessionId, set); }
  set.add(res);

  // Keepalive pings so the connection survives idle periods
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { cleanup(); }
  }, KEEPALIVE_MS);

  function cleanup() {
    clearInterval(ping);
    const s = sessionSubscribers.get(sessionId);
    if (s) {
      s.delete(res);
      if (s.size === 0) sessionSubscribers.delete(sessionId);
    }
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
}

/**
 * Publish an event to all SSE subscribers for a session.
 *
 * @param {string} sessionId
 * @param {{ type: string, [key: string]: unknown }} payload
 */
function publish(sessionId, payload) {
  if (!sessionId) return;
  const set = sessionSubscribers.get(sessionId);
  if (!set || set.size === 0) return;

  const line = `data: ${JSON.stringify({ ...payload, t: Date.now() })}\n\n`;
  for (const r of set) {
    try { r.write(line); } catch (_) { /* client gone */ }
  }
}

/**
 * Convenience: publish a token acquisition event.
 */
function publishToken(sessionId, { id, label, status, decoded = null, error = null, expiresAt = null }) {
  publish(sessionId, { type: 'token', id, label, status, decoded, error, expiresAt });
}

/**
 * Convenience: publish a token exchange event.
 */
function publishExchange(sessionId, { id, label, status, decoded = null, subjectDecoded = null, actorDecoded = null, error = null }) {
  publish(sessionId, { type: 'exchange', id, label, status, decoded, subjectDecoded, actorDecoded, error });
}

/**
 * Convenience: publish a tracked API call.
 */
function publishApiCall(sessionId, { method, url, status, duration, category, description }) {
  publish(sessionId, { type: 'api_call', method, url, status, duration, category, description });
}

module.exports = { attach, publish, publishToken, publishExchange, publishApiCall };
