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
 * Emit a structured audit record for a decision, and return the same record
 * so callers (routes/decision.js's permit()/deny()/indeterminate() helpers)
 * can forward it verbatim as the transaction-hop `details` field — one
 * computed object, two destinations (stdout + ledger), no chance of drift.
 *
 * PERMIT is audited alongside DENY / INDETERMINATE so the stdout trail is
 * complete for a human reading container logs. Note this sink is stdout-only —
 * the machine-readable path the reconciler uses is transactionHop.emitHop.
 * @param {'PERMIT'|'DENY'|'INDETERMINATE'} decision
 * @param {string} reason
 * @param {{decisionId?: string, policyVersion?: string}} [extra] - fields the
 *   terminal response helpers compute themselves (decision_id/policy_version
 *   are generated inline in permit()/deny()/indeterminate(), not carried in
 *   the ALS decision context).
 * @returns {object} the full record that was logged
 */
function auditDecision(decision, reason, extra) {
  const ctx = getDecisionContext();
  const record = {
    evt: 'authz_decision',
    decision,
    reason: reason || null,
    correlationId: getCorrelationId() || null,
    decisionContext: ctx.decisionContext || null,
    tool: ctx.tool || null,
    sub: ctx.sub || null,
    actor: ctx.actor || null,
    workerId: ctx.workerId || null,
    scopes: ctx.scopes || [],
    rarPresent: ctx.rarPresent || false,
    intentValid: ctx.intentValid || null,
    intentMatch: ctx.intentMatch || null,
    hitlApproved: ctx.hitlApproved || false,
    decisionId: (extra && extra.decisionId) || null,
    policyVersion: (extra && extra.policyVersion) || null,
  };
  console.log(JSON.stringify(record));
  return record;
}

module.exports = { log, warn, auditDecision };
