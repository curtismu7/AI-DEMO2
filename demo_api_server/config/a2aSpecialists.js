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
  admin: {
    appKey: 'identity',
    appName: 'Super Banking Identity Verification Specialist Agent',
    specialistName: 'Identity Verification Specialist',
    tools: ['sensitive_customer_identity'],
    subtaskHint: 'retrieve the customer’s identity-verification (KYC) record',
  },
};

// White-label verticals can share the underlying domain specialist without
// provisioning a duplicate PingOne app or duplicating its appKey.
const A2A_SPECIALIST_ALIASES = {
  'abercrombie-fitch': 'retail',
};

/** All verticals that have an A2A specialist, including white-label aliases. */
function verticalsWithSpecialist() {
  return [...Object.keys(A2A_SPECIALISTS), ...Object.keys(A2A_SPECIALIST_ALIASES)];
}

/**
 * Public display metadata for the A2A specialist directory.
 * The directory intentionally contains no credentials or scope grants; the
 * signed Agent Card remains the source for protocol capabilities.
 */
function specialistDirectory() {
  return verticalsWithSpecialist().map((vertical) => {
    const canonicalVertical = A2A_SPECIALIST_ALIASES[vertical] || vertical;
    const specialist = A2A_SPECIALISTS[canonicalVertical];
    return {
      vertical,
      canonicalVertical,
      appKey: specialist.appKey,
      appName: specialist.appName,
      specialistName: specialist.specialistName,
      tools: [...(specialist.tools || [])],
      subtaskHint: specialist.subtaskHint,
    };
  });
}

/** Resolve the specialist for a vertical (null if none). */
function specialistForVertical(vertical) {
  if (!vertical) return null;
  const canonical = A2A_SPECIALIST_ALIASES[vertical] || vertical;
  return A2A_SPECIALISTS[canonical] || null;
}

/**
 * What the Privilege A2A demo steps (25, 25A, 26) show for a vertical: the name of
 * its generalist agent and 3 canned questions for its specialist. Display data only;
 * the specialist identity, tools and subtask hint stay in A2A_SPECIALISTS above.
 */
const A2A_DEMO_PROFILES = {
  banking: {
    agentName: 'Super Banking agent',
    questions: ['Review my investment positions.', 'What is my current investment balance?', 'Show my recent investment transactions.'],
  },
  healthcare: {
    agentName: 'CareConnect agent',
    questions: ['Retrieve my patient health record.', 'Do my records show any current prescriptions?', 'Which conditions are listed on my record?'],
  },
  retail: {
    agentName: 'Great Buy agent',
    questions: ['Review my recent order history.', 'Which of my purchases were returned?', 'What was my largest order this year?'],
  },
  'sporting-goods': {
    agentName: 'Super Sports agent',
    questions: ['Review my membership details.', 'When does my membership renew?', 'Which membership benefits do I have?'],
  },
  workforce: {
    agentName: 'WX Workforce agent',
    questions: ['Review my payroll details.', 'Show the deductions on my last pay period.', 'What is my current pay grade?'],
  },
  government: {
    agentName: 'CivicPermit agent',
    questions: ['Retrieve my tax assessment record.', 'Is there an outstanding balance on my assessment?', 'When was my property last assessed?'],
  },
  university: {
    agentName: 'Super University agent',
    questions: ['Review my financial aid record.', 'Which aid awards are pending disbursement?', 'What is my remaining tuition balance?'],
  },
  manufacturing: {
    agentName: 'Precision Works agent',
    questions: ['Review the supplier contract terms.', 'When does the supplier contract expire?', 'What are the contract’s payment terms?'],
  },
  investment: {
    agentName: 'Meridian Wealth agent',
    questions: ['Review my investment holdings.', 'Which holdings make up most of my portfolio?', 'What is the total value of my holdings?'],
  },
  airlines: {
    agentName: 'United Airlines agent',
    questions: ['Retrieve my passenger record.', 'What loyalty status is on my passenger record?', 'Which upcoming trips are on my record?'],
  },
  admin: {
    agentName: 'PingOne Admin agent',
    questions: ['Retrieve the customer’s identity-verification record.', 'Has this customer completed KYC?', 'When was the identity last verified?'],
  },
};

// White-label verticals share their domain's questions but keep their own brand.
const A2A_DEMO_ALIAS_AGENT_NAMES = {
  'abercrombie-fitch': 'Abercrombie & Fitch agent',
};

/**
 * The Privilege A2A demo profile for a vertical, or null when it has no specialist
 * (the demo then falls back to the generic access review).
 *   { vertical, agentName, specialistName, tool, tools, subtaskHint, questions }
 */
function a2aDemoProfile(vertical) {
  const specialist = specialistForVertical(vertical);
  if (!specialist) return null;
  const canonical = A2A_SPECIALIST_ALIASES[vertical] || vertical;
  const demo = A2A_DEMO_PROFILES[canonical];
  if (!demo) return null;
  return {
    vertical,
    agentName: A2A_DEMO_ALIAS_AGENT_NAMES[vertical] || demo.agentName,
    specialistName: specialist.specialistName,
    tool: specialist.tools[0],
    tools: [...specialist.tools],
    subtaskHint: specialist.subtaskHint,
    questions: [...demo.questions],
  };
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
  specialistDirectory,
  verticalsWithSpecialist,
  specialistForVertical,
  a2aDemoProfile,
  A2A_DEMO_PROFILES,
  clientIdKey,
  clientSecretKey,
  intermediateAudienceKey,
  intermediateResourceName,
  A2A_GATEWAY_RESOURCE_NAME,
};
