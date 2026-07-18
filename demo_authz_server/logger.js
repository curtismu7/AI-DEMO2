'use strict';

/**
 * Correlation-aware logging for the mock Authorization Server.
 *
 * log()/warn() behave like console.log/warn but prefix the request's
 * correlation id so every decision line is traceable back to the originating
 * BFF request. auditDecision() emits a single structured JSON record for a
 * DENY / INDETERMINATE outcome — the authz "audit sink" the assessment asked
 * for (failed-delegation / authz-deny events with structured fields).
 */

const {
  getCorrelationId,
  getDecisionContext,
} = require('./correlationContext');

function prefix(args) {
  const cid = getCorrelationId();
  return cid ? [`[cid=${cid}]`, ...args] : args;
}

function log(...args) {
  console.log(...prefix(args));
}

function warn(...args) {
  console.warn(...prefix(args));
}

/**
 * Emit a structured audit record for a decision.
 *
 * PERMIT is audited alongside DENY / INDETERMINATE so the stdout trail is
 * complete for a human reading container logs. Note this sink is stdout-only —
 * the machine-readable path the reconciler uses is transactionHop.emitHop.
 * @param {'PERMIT'|'DENY'|'INDETERMINATE'} decision
 * @param {string} reason
 */
function auditDecision(decision, reason) {
  const ctx = getDecisionContext();
  console.log(
    JSON.stringify({
      evt: 'authz_decision',
      decision,
      reason: reason || null,
      correlationId: getCorrelationId() || null,
      decisionContext: ctx.decisionContext || null,
      tool: ctx.tool || null,
      sub: ctx.sub || null,
      actor: ctx.actor || null,
      workerId: ctx.workerId || null,
    }),
  );
}

module.exports = { log, warn, auditDecision };
