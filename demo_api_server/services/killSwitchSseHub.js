'use strict';

/**
 * Session-keyed SSE hub for the kill switch — lets KillSwitchConfirmModal
 * render each step (token_revocation, user_disable, ...) as it runs instead
 * of only after the whole POST /kill-switch resolves. Same shape as
 * pingoneTestSseHub.js; kept separate because the two features share nothing
 * but the transport pattern.
 *
 * Event envelope: { type: "step", step: {...}, t }
 */

/** @type {Map<string, Set<import('express').Response>>} sessionId → SSE responses */
const sessionSubscribers = new Map();

const KEEPALIVE_MS = 20_000;

/**
 * Open an SSE stream for a session. Leaves res open; caller must NOT call
 * res.end() — the hub manages lifetime.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function attach(req, res) {
  const sessionId = req.sessionID || 'kill-switch';

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(': sse connected\n\n');

  let set = sessionSubscribers.get(sessionId);
  if (!set) { set = new Set(); sessionSubscribers.set(sessionId, set); }
  set.add(res);

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
 * Publish a kill-switch step to all SSE subscribers for a session.
 *
 * @param {string} sessionId
 * @param {{ agentId: string, step: object }} payload
 */
function publishStep(sessionId, { agentId, step }) {
  if (!sessionId) return;
  const set = sessionSubscribers.get(sessionId);
  if (!set || set.size === 0) return;

  const line = `data: ${JSON.stringify({ type: 'step', agentId, step, t: Date.now() })}\n\n`;
  for (const r of set) {
    try { r.write(line); } catch (_) { /* client gone */ }
  }
}

module.exports = { attach, publishStep };
