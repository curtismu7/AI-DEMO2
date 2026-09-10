'use strict';

/**
 * In-memory recorder for the login redirect sequence (BFF mints PKCE → PingOne
 * hosted login → callback → token exchange → session regenerate). The browser
 * leaves the SPA entirely for the PingOne hop, so this can't be a live SSE
 * stream like the MCP tool-call diagram — instead routes/oauthUser.js records
 * each real hop as it happens, keyed by a one-time trace id round-tripped
 * through the session, and the SPA fetches the finished list once it lands
 * back signed in.
 *
 * ponytail: single-process Map — a login trace that starts on one serverless
 * instance and finishes on another (Vercel) loses the diagram, not the login.
 * Purely additive observability; every call is safe to no-op or swallow.
 */

const TRACE_TTL_MS = 5 * 60 * 1000;

const traces = new Map();

function sweep() {
  const cutoff = Date.now() - TRACE_TTL_MS;
  for (const [id, trace] of traces) {
    if (trace.createdAt < cutoff) traces.delete(id);
  }
}

function start(id) {
  if (!id) return;
  sweep();
  traces.set(id, { steps: [], createdAt: Date.now() });
}

function addStep(id, step) {
  try {
    if (!id || !step) return;
    const trace = traces.get(id);
    if (!trace) return;
    trace.steps.push({ ...step, step: trace.steps.length + 1 });
  } catch (_) {
    // tracing must never break the login it is observing
  }
}

/** Returns the recorded steps and deletes the trace — single read. */
function finish(id) {
  if (!id) return [];
  const trace = traces.get(id);
  traces.delete(id);
  return trace ? trace.steps : [];
}

module.exports = { start, addStep, finish };
