'use strict';

/**
 * Per-vertical A2A specialist registry — single source of truth.
 *
 * Each vertical's generalist agent (Agent 1) can delegate a narrow, sensitive
 * read task to a dedicated specialist agent (Agent 2). The delegation is approved
 * by PingOne Authorize reading the nested `act` chain
 * (act:{sub:specialist, act:{sub:generalist}}) — Authorize is the sole approver.
 *
 * SCOPES ARE NOT DECLARED HERE. scope-topology.json is the single source of truth
 * for scopes; each specialist's requested scope is DERIVED from the SoT via its
 * `tools` (scopeTopology.toolScopes). This registry only maps a vertical to its
 * specialist identity + the tool(s) it is allowed to call.
 *
 * `appKey` drives the config keys for the specialist's PingOne app credentials:
 *   client id  → getEffective('pingone_<appKey>_agent_client_id')
 *                env PINGONE_A2A_<APPKEY>_AGENT_CLIENT_ID
 *   secret     → getEffective('pingone_<appKey>_agent_client_secret')
 *                env PINGONE_A2A_<APPKEY>_AGENT_CLIENT_SECRET
 *
 * `appName` is the canonical scope-topology app name (bootstrap provisions it).
 *
 * Consumed by a2aDelegationService (runtime) and pingoneProvisionService (bootstrap).
 */

const A2A_SPECIALISTS = {
  banking: {
    appKey: 'investment',
    appName: 'Super Banking Investment Advisor Agent',
    specialistName: 'Investment Advisor',
    tools: ['get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions'],
    subtaskHint: 'review the customer’s investment positions',
  },
  healthcare: {
    appKey: 'records',
    appName: 'Super Banking Records Specialist Agent',
    specialistName: 'Records Specialist',
    tools: ['sensitive_patient_records'],
    subtaskHint: 'retrieve the sensitive patient health record',
  },
  retail: {
    appKey: 'purchase',
    appName: 'Super Banking Purchase Specialist Agent',
    specialistName: 'Purchase History Specialist',
    tools: ['sensitive_order_history'],
    subtaskHint: 'review the sensitive order / purchase history',
  },
  'sporting-goods': {
    appKey: 'membership',
    appName: 'Super Banking Membership Specialist Agent',
    specialistName: 'Membership Specialist',
    tools: ['sensitive_membership_details'],
    subtaskHint: 'review the sensitive membership details',
  },
  workforce: {
    appKey: 'payroll',
    appName: 'Super Banking Payroll Specialist Agent',
    specialistName: 'Payroll Specialist',
    tools: ['sensitive_payroll_details'],
    subtaskHint: 'review the sensitive payroll details',
  },
};

/** All verticals that have an A2A specialist. */
function verticalsWithSpecialist() {
  return Object.keys(A2A_SPECIALISTS);
}

/** Resolve the specialist for a vertical (null if none). */
function specialistForVertical(vertical) {
  if (!vertical) return null;
  return A2A_SPECIALISTS[vertical] || null;
}

/** configStore key (lowercase) for a specialist's client id, derived from appKey. */
function clientIdKey(appKey) {
  return `pingone_${appKey}_agent_client_id`;
}
/** configStore key (lowercase) for a specialist's client secret, derived from appKey. */
function clientSecretKey(appKey) {
  return `pingone_${appKey}_agent_client_secret`;
}

module.exports = {
  A2A_SPECIALISTS,
  verticalsWithSpecialist,
  specialistForVertical,
  clientIdKey,
  clientSecretKey,
};
