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
  government: {
    appKey: 'tax',
    appName: 'Super Banking Tax Records Specialist Agent',
    specialistName: 'Tax Records Specialist',
    tools: ['sensitive_tax_record'],
    subtaskHint: 'retrieve the sensitive tax assessment record',
  },
  university: {
    appKey: 'finaid',
    appName: 'Super Banking Financial Aid Specialist Agent',
    specialistName: 'Financial Aid Specialist',
    tools: ['sensitive_student_finance'],
    subtaskHint: 'review the sensitive student financial aid record',
  },
  manufacturing: {
    appKey: 'supplier',
    appName: 'Super Banking Supplier Contract Specialist Agent',
    specialistName: 'Supplier Contract Specialist',
    tools: ['sensitive_supplier_contract'],
    subtaskHint: 'review the sensitive supplier contract terms',
  },
  investment: {
    appKey: 'holdings',
    appName: 'Super Banking Holdings Specialist Agent',
    specialistName: 'Holdings Specialist',
    tools: ['sensitive_holdings'],
    subtaskHint: 'review the sensitive investment holdings',
  },
  airlines: {
    appKey: 'passenger',
    appName: 'Super Banking Passenger Records Specialist Agent',
    specialistName: 'Passenger Records Specialist',
    tools: ['sensitive_passenger_record'],
    subtaskHint: 'retrieve the sensitive passenger record',
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

/**
 * configStore key (lowercase) for a specialist's OWN A2A Intermediate audience.
 * Each specialist gets a dedicated resource/audience (RFC 8707 — see
 * pingoneProvisionService.js Step 37a-A2A and docs/ACT_CLAIM_VERIFICATION.md),
 * never a value shared across specialists.
 */
function intermediateAudienceKey(appKey) {
  return `a2a_intermediate_audience_${appKey}`;
}

/**
 * scope-topology.json resource name for this specialist's Exchange #1 audience.
 * Must match resources[] keys provisioned in Step 37a-A2A.
 */
function intermediateResourceName(specialist) {
  if (!specialist?.specialistName) return null;
  return `Super Banking A2A Intermediate - ${specialist.specialistName}`;
}

/** scope-topology.json resource name for A2A Exchange #2 gateway audience. */
const A2A_GATEWAY_RESOURCE_NAME = 'Super Banking A2A MCP Gateway';

module.exports = {
  A2A_SPECIALISTS,
  verticalsWithSpecialist,
  specialistForVertical,
  clientIdKey,
  clientSecretKey,
  intermediateAudienceKey,
  intermediateResourceName,
  A2A_GATEWAY_RESOURCE_NAME,
};
