'use strict';

/**
 * GET /rules
 * Returns the structured rule definitions enforced by this mock authz server.
 * Used by the UI to show "live" rules from our built authorization server.
 */

const path = require('path');
const ruleStore = require('../ruleStore');

let toolsManifest = {};
try {
  toolsManifest = require(path.join(__dirname, '..', '..', 'scope-topology.json')).tools || {};
} catch { /* ignore */ }

const WORKER_ID = process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';

// Tool → vertical mapping (matches the vertical manifests under config/verticals/)
const VERTICAL_TOOL_MAP = {
  'Banking':       ['get_my_accounts','get_account_balance','get_account_nickname','get_my_transactions','get_sensitive_account_details','create_deposit','create_withdrawal','create_transfer','get_investment_balance','get_investment_accounts','get_portfolio_summary','show_mortgage','sequential_think'],
  'Healthcare':    ['show_health_record','view_records','view_coverage','list_appointments','book_appointment','release_records','sensitive_patient_records'],
  'Retail':        ['show_large_purchase','list_orders','order_status','rewards_balance','checkout','sensitive_order_history'],
  'Sporting Goods':['show_gear_order','list_gear','list_rentals','gear_order_status','loyalty_balance','extend_rental','sensitive_membership_details'],
  'Workforce':     ['view_benefits','pto_balance','list_expenses','submit_expense','request_time_off','sensitive_payroll_details'],
  'Government':     ['show_permit','view_permits','view_fees','view_filings','pay_fee','release_record','sensitive_tax_record'],
  'University':    ['show_enrollment','view_courses','view_standing','register_course','release_transcript','sensitive_student_finance'],
  'Manufacturing': ['show_work_order','view_work_orders','view_inventory','schedule_run','release_work_order','sensitive_supplier_contract'],
};

module.exports = function rulesHandler(_req, res) {
  // Build per-tool scope requirements (gateway-surface tools only)
  const toolScopes = {};
  const writeTools = [];
  for (const [toolName, toolDef] of Object.entries(toolsManifest)) {
    if (toolDef.surface === 'gateway') {
      // Source from ruleStore so admin overrides show through (falls back to SoT).
      toolScopes[toolName] = ruleStore.requiredScopesForTool(toolName) || [];
      if (ruleStore.isWriteTool(toolName)) writeTools.push(toolName);
    }
  }

  const authorizedActor = ruleStore.getAuthorizedActorClientId();

  // Build vertical → { toolName: scopes[] } for the UI vertical picker
  const verticalGroups = {};
  for (const [vertical, tools] of Object.entries(VERTICAL_TOOL_MAP)) {
    const group = {};
    for (const t of tools) {
      if (toolScopes[t]) group[t] = toolScopes[t];
    }
    if (Object.keys(group).length) verticalGroups[vertical] = group;
  }

  res.json({
    source: 'mock_authz_server',
    version: 'mock-v1',
    policyId: WORKER_ID,
    decisionPath: `/governance/pap/alpha/policy/${WORKER_ID}/decision`,
    introspectionPath: '/as/introspect',
    rules: [
      {
        id: 'tool-discovery',
        priority: 1,
        name: 'Tool Discovery',
        context: 'McpToolsList',
        decision: ruleStore.getToolDiscoveryDecision(),
        description: 'Requests with DecisionContext=McpToolsList are permitted by default — tool listing is not gated unless an admin sets this rule to DENY.',
        config: {},
      },
      {
        id: 'actor-identity',
        priority: 2,
        name: 'Actor Identity (act claim)',
        context: 'McpToolCall',
        decision: 'DENY',
        description: 'When an act claim is present, act.sub must exactly match the authorized agent client ID. An unrecognized actor is denied.',
        config: {
          authorizedActorClientId: authorizedActor || null,
          configured: !!authorizedActor,
          note: authorizedActor
            ? null
            : 'No authorized actor configured — act claim check skipped in legacy static mode (any actor permitted).',
        },
      },
      {
        id: 'scope-enforcement',
        priority: 3,
        name: 'Scope Enforcement',
        context: 'McpToolCall',
        decision: 'DENY',
        description: 'Each tool requires specific OAuth scopes from the token. Missing any required scope results in DENY with reason insufficient_scope.',
        config: { toolScopes, verticalGroups },
      },
      {
        id: 'hitl-gate',
        priority: 4,
        name: 'HITL Write Gate',
        context: 'McpToolCall',
        decision: 'INDETERMINATE',
        description: `Write tool calls without prior HITL approval are returned as INDETERMINATE. An empty TransactionAmount also triggers HITL (unknown amount = high risk).`,
        config: {
          thresholdUsd: ruleStore.getHitlThreshold(),
          writeTools,
          note: 'Set HitlApproved=true and HitlChallengeId=<id> after a verified HITL receipt to discharge this gate.',
        },
      },
      {
        id: 'a2a-delegation-required',
        priority: 5,
        name: 'A2A delegation required',
        context: 'McpToolCall',
        decision: 'DENY',
        description:
          'Tools flagged a2aDelegated in scope-topology (e.g. get_portfolio_summary) require ActChainDepth >= 2. A generalist acting alone is denied with a2a_delegation_required.',
        config: {},
      },
      {
        id: 'a2a-nested-generalist',
        priority: 6,
        name: 'Nested generalist identity',
        context: 'McpToolCall',
        decision: 'DENY',
        description:
          'At depth >= 2, NestedActClientId must equal the registered AI Agent client ID (generalist). Mismatch → invalid_a2a_generalist.',
        config: {},
      },
    ],
    editable: ruleStore.getEditableBlock(),
  });
};
