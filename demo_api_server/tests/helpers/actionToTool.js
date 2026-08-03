'use strict';

/**
 * Heuristic ACTION -> dispatched TOOL where they differ. Vertical plugin actions
 * ARE their tool names (identity fallback). Shared by useCases.primaryTool.test.js
 * and stepVerification.banking.test.js — one source of truth, not two copies.
 */
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  // Banking's own high-value action — step-up gated on the TOOL, so it must map
  // to its own tool name rather than collapsing onto create_transfer.
  wire_transfer: 'create_wire_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  // The 7th (and previously only missing) inverse of banking's own
  // TOOL_NAME_TO_ACTION map (config/verticals/banking/index.js:337-345). The
  // heuristic action is the alias — tagged heuristicOnly so it is never
  // LLM-callable — and get_sensitive_account_details is the real MCP tool.
  sensitive_account_details: 'get_sensitive_account_details',
  branch_hours: 'get_branch_hours',
  weather: 'get_weather',
  mortgage_demo: 'show_mortgage',
  // Sporting-goods' own Path A feature tool (UC33) — same alias shape as
  // mortgage_demo: the heuristic action is a placeholder, the MCP tool is the
  // api_key-disposition show_gear_warranty.
  gear_warranty_demo: 'show_gear_warranty',
  // Cross-vertical portfolio chip — always dispatches show_investment, whatever
  // the active vertical's own featurePage tool is (AIAgent.js case "invest_demo").
  invest_demo: 'show_investment',
};

/**
 * `vertical_feature_demo` is the ONE action whose tool depends on the vertical:
 * AIAgent.js dispatches `themeManifest.featurePage.mcpTool`, so the same action
 * means show_health_record in healthcare and show_permit in government. A flat
 * map cannot express that, so callers that know the vertical use this instead.
 *
 * Keep SECOND_PRODUCT_TOOL_BY_VERTICAL as the single source: it IS the set of
 * featurePage tools, and useCases.scenarioDistinctness.test.js asserts the two
 * agree, so a manifest change that is not mirrored in the catalog fails loudly
 * rather than making this helper quietly wrong.
 */
const { SECOND_PRODUCT_TOOL_BY_VERTICAL } = require('../../config/useCases.js');

function toolForAction(action, vertical) {
  if (action === 'vertical_feature_demo') {
    return SECOND_PRODUCT_TOOL_BY_VERTICAL[vertical] || action;
  }
  return ACTION_TO_TOOL[action] || action;
}

module.exports = { ACTION_TO_TOOL, toolForAction };
