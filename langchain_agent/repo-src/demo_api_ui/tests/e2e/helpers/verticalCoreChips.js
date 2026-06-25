// demo_api_ui/tests/e2e/helpers/verticalCoreChips.js
'use strict';
/**
 * Per-vertical chip matrix for skip-proof MCP pipeline E2E.
 *
 * Edit E2E_VERTICAL_CORE_PRESETS when adding a vertical or changing which
 * patient/customer phrases must traverse Authorize → gateway → MCP server.
 * Each entry needs: message (chip text), expectedAction (heuristic/NL), mcpTool
 * (plugin tool name on the MCP server — usually same as expectedAction).
 *
 * Run:
 *   E2E_VERTICAL=healthcare npm run test:e2e:real:vertical:core
 *   npm run test:e2e:real:careconnect:core   # alias → healthcare
 */

/** @typedef {{ id: string, label: string, message: string, expectedAction: string, mcpTool: string }} VerticalCoreChip */

/**
 * Curated chips per vertical (subset of manifest chips10, mode "both").
 * Add a vertical by copying the pattern from healthcare.
 */
const E2E_VERTICAL_CORE_PRESETS = {
  healthcare: [
    {
      id: 'hc1',
      label: 'My records',
      message: 'my records',
      expectedAction: 'view_records',
      mcpTool: 'view_records',
    },
    {
      id: 'hc3',
      label: 'My appointments',
      message: 'my appointments',
      expectedAction: 'list_appointments',
      mcpTool: 'list_appointments',
    },
    {
      id: 'hc7',
      label: 'Upcoming visits',
      message: 'upcoming visits',
      expectedAction: 'list_appointments',
      mcpTool: 'list_appointments',
    },
  ],
  manufacturing: [
    {
      id: 'mf1',
      label: 'My work orders',
      message: 'show my work orders',
      expectedAction: 'view_work_orders',
      mcpTool: 'view_work_orders',
    },
    {
      id: 'mf2',
      label: 'Inventory',
      message: 'what is my on-hand inventory',
      expectedAction: 'view_inventory',
      mcpTool: 'view_inventory',
    },
    {
      id: 'mf3',
      label: 'Production history',
      message: 'show my production history',
      expectedAction: 'view_production_history',
      mcpTool: 'view_production_history',
    },
  ],
  government: [
    {
      id: 'gv1',
      label: 'My permits',
      message: 'show my permits',
      expectedAction: 'view_permits',
      mcpTool: 'view_permits',
    },
    {
      id: 'gv2',
      label: 'Fees owed',
      message: 'what fees do I owe',
      expectedAction: 'view_fees',
      mcpTool: 'view_fees',
    },
    {
      id: 'gv3',
      label: 'Filing history',
      message: 'show my filing history',
      expectedAction: 'view_filings',
      mcpTool: 'view_filings',
    },
  ],
  university: [
    {
      id: 'un1',
      label: 'My courses',
      message: 'show my enrolled courses',
      expectedAction: 'view_courses',
      mcpTool: 'view_courses',
    },
    {
      id: 'un2',
      label: 'Credit standing',
      message: 'what is my credit standing',
      expectedAction: 'view_standing',
      mcpTool: 'view_standing',
    },
    {
      id: 'un3',
      label: 'Enrollment history',
      message: 'show my enrollment history',
      expectedAction: 'view_enrollment_history',
      mcpTool: 'view_enrollment_history',
    },
  ],
  retail: [
    {
      id: 'rt1',
      label: 'List my orders',
      message: 'list my orders',
      expectedAction: 'list_orders',
      mcpTool: 'list_orders',
    },
    {
      id: 'rt2',
      label: "Where's my order?",
      message: 'order status',
      expectedAction: 'order_status',
      mcpTool: 'order_status',
    },
    {
      id: 'rt3',
      label: 'My reward points',
      message: 'my reward points',
      expectedAction: 'rewards_balance',
      mcpTool: 'rewards_balance',
    },
  ],
  workforce: [
    {
      id: 'wf1',
      label: 'My benefits',
      message: 'my benefits',
      expectedAction: 'view_benefits',
      mcpTool: 'view_benefits',
    },
    {
      id: 'wf2',
      label: 'PTO balance',
      message: 'pto balance',
      expectedAction: 'pto_balance',
      mcpTool: 'pto_balance',
    },
    {
      id: 'wf3',
      label: 'My expenses',
      message: 'my expenses',
      expectedAction: 'list_expenses',
      mcpTool: 'list_expenses',
    },
  ],
  'sporting-goods': [
    {
      id: 'sg1',
      label: 'My gear',
      message: 'my gear',
      expectedAction: 'list_gear',
      mcpTool: 'list_gear',
    },
    {
      id: 'sg2',
      label: 'My rentals',
      message: 'my rentals',
      expectedAction: 'list_rentals',
      mcpTool: 'list_rentals',
    },
    {
      id: 'sg5',
      label: 'My loyalty points',
      message: 'my loyalty points',
      expectedAction: 'loyalty_balance',
      mcpTool: 'loyalty_balance',
    },
  ],
};

const SUPPORTED_VERTICALS = Object.keys(E2E_VERTICAL_CORE_PRESETS);

/**
 * Active vertical for E2E (env E2E_VERTICAL, default healthcare).
 * @returns {string}
 */
function resolveE2eVerticalId() {
  const id = (process.env.E2E_VERTICAL || 'healthcare').trim().toLowerCase();
  if (!SUPPORTED_VERTICALS.includes(id)) {
    throw new Error(
      `E2E_VERTICAL="${id}" is not in E2E_VERTICAL_CORE_PRESETS. Supported: ${SUPPORTED_VERTICALS.join(', ')}`,
    );
  }
  return id;
}

/**
 * @param {string} [verticalId]
 * @returns {VerticalCoreChip[]}
 */
function getVerticalCoreChips(verticalId = resolveE2eVerticalId()) {
  const chips = E2E_VERTICAL_CORE_PRESETS[verticalId];
  if (!chips || chips.length === 0) {
    throw new Error(`No E2E core chips defined for vertical "${verticalId}"`);
  }
  return chips;
}

/** @deprecated Use getVerticalCoreChips('healthcare') */
const CARECONNECT_CORE_CHIPS = E2E_VERTICAL_CORE_PRESETS.healthcare;

module.exports = {
  E2E_VERTICAL_CORE_PRESETS,
  SUPPORTED_VERTICALS,
  resolveE2eVerticalId,
  getVerticalCoreChips,
  CARECONNECT_CORE_CHIPS,
};
