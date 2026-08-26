'use strict';
/**
 * autonomousAuthorize.js — ask the policy engine whether an unattended agent may
 * move this money on its own.
 *
 * Why this exists rather than a call into transactionAuthorizationService: that
 * service is session-shaped (userRole, userId, acr, hitlAlreadyVerified) and
 * sits on the path every banking transaction takes. An unattended run has no
 * user, no role and no acr, and widening a protected shared path to carry a
 * caller that has none of them buys nothing here — the decision endpoint is the
 * same one either way, and the policy is the same policy.
 *
 * The mandate ceiling travels as a request attribute rather than living in the
 * policy as a constant, the same way RAR sends its attested ceiling
 * (decision.js Rule 3c): the number is a property of the agent's declaration,
 * and the POLICY owns whether exceeding it is permitted, denied, or a pause.
 * That is the part that matters — the ceiling is enforced by the PDP, not by
 * the job that wants to spend.
 */

const axios = require('axios');
const { getMandate } = require('./agentMandate');

// Same resolution a2aDelegationService uses (services/a2aDelegationService.js:71).
function _endpoint() {
  return process.env.PINGAUTHORIZE_ENDPOINT || 'http://localhost:9001';
}

function _workerId() {
  return process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';
}

/** Did the decision come back carrying an unfulfilled CIBA obligation? */
function _cibaObligation(data) {
  const obligations = (data && data.obligations) || [];
  return obligations.find((o) => o && o.id === 'ciba-approval' && o.fulfilled === false) || null;
}

/**
 * @param {object} args
 *   - agentName {string} scope-topology apps{} key
 *   - amount {number}
 *   - type {string} transaction type, for the audit trail
 * @returns {Promise<{
 *   outcome: 'permit'|'pause'|'deny'|'unavailable',
 *   decision: string|null, reason: string|null, code: string|null,
 *   mandate: object|null, raw: object|null, error?: string
 * }>}
 */
async function authorizeUnattendedTransfer({ agentName, amount, type = 'transfer', httpClient = axios }) {
  const mandate = getMandate(agentName);

  const parameters = {
    // Not an MCP context, so the cloud routes this to the Transaction policy —
    // which is where amount rules live (MCP contexts go to Delegation).
    DecisionContext: 'Transaction',
    AgentClass: 'autonomous',
    // '' when nothing is declared. The policy reads that as "nothing to
    // evaluate against" and fails closed; it is not the caller's call to make.
    MandateMaxAmount: mandate ? String(mandate.maxAmount) : '',
    TransactionAmount: String(amount),
    TransactionType: type,
    ClientId: agentName,
    ActClientId: '',
    TokenScopes: 'transfer',
  };

  const url = `${_endpoint()}/governance/pap/alpha/policy/${_workerId()}/decision`;

  let data;
  try {
    const res = await httpClient.post(url, { parameters }, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });
    data = res.data || {};
  } catch (err) {
    // The PDP being unreachable is NOT a permit. An unattended agent that
    // cannot be authorized does not act.
    return {
      outcome: 'unavailable', decision: null, reason: null, code: null,
      mandate, raw: null, error: err.message || 'authorize_unavailable',
    };
  }

  const decision = String(data.decision || '').toUpperCase();
  const code = (data.statements && data.statements[0] && data.statements[0].code) || null;

  if (decision === 'DENY') {
    return { outcome: 'deny', decision, reason: data.reason || null, code, mandate, raw: data };
  }
  if (decision === 'PERMIT' && _cibaObligation(data)) {
    return { outcome: 'pause', decision, reason: data.reason || null, code, mandate, raw: data };
  }
  if (decision === 'PERMIT') {
    return { outcome: 'permit', decision, reason: data.reason || null, code, mandate, raw: data };
  }
  // Anything else (including an empty body) is not an authorization.
  return {
    outcome: 'unavailable', decision: decision || null, reason: data.reason || null,
    code, mandate, raw: data, error: 'unrecognized_decision',
  };
}

module.exports = { authorizeUnattendedTransfer };
