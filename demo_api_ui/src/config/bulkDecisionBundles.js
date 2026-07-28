// demo_api_ui/src/config/bulkDecisionBundles.js
//
// Canned test-data bundles for the P1AZ Inspector's "Bulk Decisions" tab.
// Each bundle is an array of { label, parameters } — one PingOne Authorize
// decisionRequests[] item per row. Base field values mirror the server's
// authoritative defaults (demo_api_server/services/policyTestCaseSolver.js
// PRESET_BASE_DEFAULTS) and the same actClientId/tokenAudience/mcpResourceUri
// fallbacks already used by this page's own MCP preset (PingOneAuthorizePage.jsx),
// so a bundle evaluates the same way a single-request preset would.

const TRANSACTION_BASE = {
  TransactionType: 'transfer',
  UserId: 'demoUser',
};

const MCP_BASE = {
  DecisionContext: 'McpFirstTool',
  UserId: 'demoUser',
  ToolName: 'transfer',
  TokenAudience: 'mcpgateway.ping.demo',
  ActClientId: 'd21c5124-8ac5-43d1-81f2-31a7ec649b96',
  McpResourceUri: 'mcpgateway.ping.demo',
  HitlApproved: false,
};

const AMOUNT_LADDER_STEPS = [100, 499, 500, 1000, 2000, 2001, 10000, 50000];

const ACR_MATRIX_AMOUNTS = [100, 2500, 10000];
const ACR_MATRIX_ACRS = ['', 'Multi_Factor'];

/** One row per amount, sweeping under/over the common $500 / $2000 thresholds. */
function amountLadder() {
  return AMOUNT_LADDER_STEPS.map((amount) => ({
    label: `$${amount.toLocaleString()}`,
    parameters: { ...TRANSACTION_BASE, Amount: amount },
  }));
}

/** Amount x ACR grid — shows whether step-up-vs-deny hinges on ACR at each band. */
function acrMatrix() {
  const rows = [];
  for (const amount of ACR_MATRIX_AMOUNTS) {
    for (const acr of ACR_MATRIX_ACRS) {
      rows.push({
        label: `$${amount.toLocaleString()} / ${acr || 'no MFA'}`,
        parameters: { ...TRANSACTION_BASE, Amount: amount, ...(acr ? { Acr: acr } : {}) },
      });
    }
  }
  return rows;
}

/** One MCP First Tool row per named banking tool, same actor/audience for all. */
function mcpToolSweep(toolNames) {
  const tools = Array.isArray(toolNames) && toolNames.length > 0
    ? toolNames
    : ['get_my_accounts', 'get_my_transactions', 'get_account_balance', 'get_sensitive_account_details', 'create_transfer'];
  return tools.slice(0, 20).map((name) => ({
    label: name,
    parameters: { ...MCP_BASE, ToolName: name },
  }));
}

/** Resource-owner binding: the caller's own resource vs. someone else's (UC13 confused-deputy shape). */
function confusedDeputy() {
  return [
    { label: 'own resource', parameters: { ...MCP_BASE, ToolName: 'get_sensitive_account_details', ResourceOwnerId: 'demoUser' } },
    { label: 'mismatched resource', parameters: { ...MCP_BASE, ToolName: 'get_sensitive_account_details', ResourceOwnerId: 'someone-else' } },
  ];
}

/**
 * @typedef {{ key: string, label: string, description: string, build: (toolNames?: string[]) => Array<{label:string, parameters:object}> }} BulkDecisionBundle
 * @type {BulkDecisionBundle[]}
 */
export const BULK_DECISION_BUNDLES = [
  {
    key: 'amount-ladder',
    label: 'Amount ladder',
    description: '8 transfers from $100 to $50,000 — shows PERMIT / STEP_UP / DENY flipping across the amount thresholds.',
    build: amountLadder,
  },
  {
    key: 'acr-matrix',
    label: 'ACR matrix',
    description: '3 amounts x with/without MFA — shows whether step-up clears the gate at each band.',
    build: acrMatrix,
  },
  {
    key: 'mcp-tool-sweep',
    label: 'MCP tool sweep',
    description: 'One MCP First Tool decision per banking tool, same actor/audience — use "Load MCP tools" to pull the live list instead.',
    build: mcpToolSweep,
  },
  {
    key: 'confused-deputy',
    label: 'Confused deputy',
    description: 'Same tool call with a matching vs. mismatched ResourceOwnerId (mirrors UC13).',
    build: confusedDeputy,
  },
];

export function findBulkDecisionBundle(key) {
  return BULK_DECISION_BUNDLES.find((b) => b.key === key) || null;
}
