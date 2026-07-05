'use strict';

/**
 * agentGatewayDecisions — in-memory ring buffer of the most recent Real Agent
 * Gateway (PingGateway / IG) authorization decisions.
 *
 * The gateway emits an X-Gw-Audit-Trail header (introspection + the full PingOne
 * Authorize request/response) on every MCP call; mcpGatewayClient.js parses it
 * into `gwAuditTrail`. record() is called there so the admin UI's decision panel
 * can show WHY a call was permitted or denied (e.g. an invalid-actor-chain DENY)
 * without the operator having to grep container logs.
 *
 * Intentionally in-memory + bounded: this is a live debugging aid, not an audit
 * of record (the durable trail is the gateway/authz logs). Lost on restart.
 */

const MAX = 50;
const buffer = []; // newest last

/**
 * Record a gateway decision from a parsed X-Gw-Audit-Trail payload.
 * Tolerant of missing fields — a malformed/absent trail is skipped, never throws.
 * @param {object} trail  parsed X-Gw-Audit-Trail ({ introspection, authorize })
 * @param {object} [meta] { tool, correlationId }
 */
function record(trail, meta = {}) {
  try {
    if (!trail || typeof trail !== 'object') return;
    const authorize = trail.authorize || {};
    const introspection = trail.introspection || {};
    const entry = {
      ts: new Date().toISOString(),
      tool: meta.tool || authorize.tool || '',
      method: authorize.method || '',
      decision: authorize.decision || 'UNKNOWN',
      backend: authorize.backend || '',
      vertical: authorize.vertical || '',
      sub: introspection.sub || '',
      clientId: introspection.client_id || '',
      correlationId: meta.correlationId || '',
      reason: authorize.reason || null,
      // statements: real PingOne Authorize deny/permit statements (the actionable
      // "why"); may be absent on the mock backend (which uses `reason`).
      statements: Array.isArray(authorize.statements) ? authorize.statements : null,
      url: authorize.url || '',
    };
    buffer.push(entry);
    if (buffer.length > MAX) buffer.shift();
  } catch (_) {
    // never let a debugging aid break a tool call
  }
}

/** Return recent decisions, newest first. */
function recent(limit = MAX) {
  const n = Math.min(Math.max(parseInt(limit, 10) || MAX, 1), MAX);
  return buffer.slice(-n).reverse();
}

function clear() { buffer.length = 0; }

module.exports = { record, recent, clear, MAX };
