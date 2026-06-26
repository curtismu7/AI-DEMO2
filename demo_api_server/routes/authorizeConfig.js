// banking_api_server/routes/authorizeConfig.js
// Admin-only endpoints for reading/writing PingOne Authorize and Simulated Authorize configuration.

'use strict';

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const {
  getAuthorizationStatusSummary,
} = require('../services/transactionAuthorizationService');
const {
  getMcpFirstToolGateStatus,
} = require('../services/mcpToolAuthorizationService');
const {
  getDenyAmountUsd,
  getStepUpAmountUsd,
  getConfirmAmountUsd,
  getConsentTypes,
  getStepUpTypes,
  AUTHORIZE_MODES,
} = require('../services/simulatedAuthorizeService');

const router = express.Router();

/**
 * GET /api/admin/authorize/config
 * Returns all authorize-related configuration in one response:
 * - Status (active engine, feature flags)
 * - Simulated rules (thresholds, MCP tool lists)
 * - PingOne credentials (masked)
 * - Env vars (for reference)
 */
router.get('/config', authenticateToken, async (_req, res) => {
  try {
    const status = getAuthorizationStatusSummary();
    const mcpStatus = getMcpFirstToolGateStatus();

    const consentTypesSet = getConsentTypes();
    const stepUpTypesSet = getStepUpTypes();
    const simulated = {
      confirmAmount: getConfirmAmountUsd(),
      denyAmount: getDenyAmountUsd(),
      stepUpAmount: getStepUpAmountUsd(),
      consentTypes: Array.from(consentTypesSet).join(','),
      stepUpTypes: Array.from(stepUpTypesSet).join(','),
      mcpDenyTools: (configStore.get('SIMULATED_MCP_DENY_TOOLS') || '').split(',').filter(Boolean),
      mcpHitlTools: (configStore.get('SIMULATED_MCP_HITL_TOOLS') || '').split(',').filter(Boolean),
    };

    const workerClientId = configStore.getEffective('authorize_worker_client_id') || '';
    const decisionEndpointId = configStore.getEffective('authorize_decision_endpoint_id') || '';
    const mcpDecisionEndpointId = configStore.getEffective('authorize_mcp_decision_endpoint_id') || '';
    const policyId = configStore.getEffective('authorize_policy_id') || '';

    const pingone = {
      workerClientId: workerClientId ? '••••' : '(not set)',
      decisionEndpointId,
      mcpDecisionEndpointId,
      policyId,
    };

    const flags = {
      authorize_enabled: true, // Always enabled for security — no toggle
      ff_authorize_simulated: configStore.get('ff_authorize_simulated') === 'true',
      ff_authorize_fail_open: configStore.get('ff_authorize_fail_open') === 'true',
      ff_authorize_deposits: configStore.get('ff_authorize_deposits') === 'true',
      ff_authorize_mcp_first_tool: configStore.get('ff_authorize_mcp_first_tool') === 'true',
    };

    const mcpResourceUri = configStore.get('PINGONE_RESOURCE_MCP_SERVER_URI') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI || '';

    const scopeDefinitions = {
      'read': {
        label: 'Read Banking Data',
        description: 'List accounts and check balances',
        permissions: ['list_accounts', 'get_balance'],
      },
      'write': {
        label: 'Write Banking Data',
        description: 'Initiate transfers, deposits, and withdrawals',
        permissions: ['transfer', 'deposit', 'withdraw'],
      },
      'mcp:invoke': {
        label: 'Invoke MCP Tools',
        description: 'Call MCP banking tools via agent',
        permissions: ['invoke_mcp_tools'],
      },
      'mortgage:read': {
        label: 'Read Mortgage Data',
        description: 'Read mortgage account data via the api-key disposition (Phase 267)',
        permissions: ['read_mortgage'],
      },
    };

    const envVars = {
      SIMULATED_AUTHORIZE_DENY_AMOUNT: configStore.get('SIMULATED_AUTHORIZE_DENY_AMOUNT') || process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT || '(default 2000)',
      SIMULATED_AUTHORIZE_CONFIRM_AMOUNT: configStore.get('SIMULATED_AUTHORIZE_CONFIRM_AMOUNT') || process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT || '(default 250)',
      SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT: configStore.get('SIMULATED_AUTHORIZE_STEPUP_AMOUNT') || process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT || '(default 500)',
      SIMULATED_AUTHORIZE_CONSENT_TYPES: configStore.get('SIMULATED_AUTHORIZE_CONSENT_TYPES') || process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES || '(default transfer)',
      SIMULATED_AUTHORIZE_STEPUP_TYPES: configStore.get('SIMULATED_AUTHORIZE_STEPUP_TYPES') || process.env.SIMULATED_AUTHORIZE_STEPUP_TYPES || '(default none)',
      SIMULATED_MCP_DENY_TOOLS: configStore.get('SIMULATED_MCP_DENY_TOOLS') || process.env.SIMULATED_MCP_DENY_TOOLS || '(none)',
      SIMULATED_MCP_HITL_TOOLS: configStore.get('SIMULATED_MCP_HITL_TOOLS') || process.env.SIMULATED_MCP_HITL_TOOLS || '(none)',
      PINGONE_RESOURCE_MCP_SERVER_URI: mcpResourceUri || '(not set)',
    };

    return res.json({
      status,
      mcp: mcpStatus,
      simulated,
      pingone,
      audience: mcpResourceUri,
      scopeDefinitions,
      flags,
      envVars,
    });
  } catch (err) {
    console.error('[authorizeConfig/config] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

/**
 * POST /api/admin/authorize/config
 * Write authorize engine mode + simulated authorize rules to configStore.
 *
 * Authorization: any signed-in user (authenticateToken) — NOT admin-only. This is
 * a teaching demo affordance: every signed-in user can tune the authorize engine
 * mode and simulated rules and watch decisions change live, mirroring the
 * mock-authz rules editor. A session is still required (no anonymous writes).
 * Body: {
 *   authorize_mode?: 'pingone'|'simulated'|'pingone_fallback_simulated',
 *   simulated_deny_amount?: number,
 *   simulated_stepup_amount?: number,
 *   simulated_mcp_deny_tools?: string (comma-separated),
 *   simulated_mcp_hitl_tools?: string (comma-separated)
 * }
 */
router.post('/config', authenticateToken, async (req, res) => {

  const { authorize_mode, simulated_confirm_amount, simulated_deny_amount, simulated_stepup_amount, simulated_consent_types, simulated_stepup_types, simulated_mcp_deny_tools, simulated_mcp_hitl_tools } = req.body || {};

  const updates = {};

  // Engine mode — single source of truth for which engine evaluates.
  if (authorize_mode !== undefined && authorize_mode !== null) {
    const m = String(authorize_mode).trim();
    if (!AUTHORIZE_MODES.includes(m)) {
      return res.status(400).json({
        error: 'invalid_authorize_mode',
        message: `authorize_mode must be one of: ${AUTHORIZE_MODES.join(', ')}.`,
      });
    }
    updates.authorize_mode = m;
  }

  if (simulated_confirm_amount !== undefined && simulated_confirm_amount !== null) {
    const val = parseFloat(simulated_confirm_amount);
    if (!isNaN(val) && val >= 0) {
      updates.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = String(val);
    }
  }

  if (simulated_deny_amount !== undefined && simulated_deny_amount !== null) {
    const val = parseFloat(simulated_deny_amount);
    if (!isNaN(val) && val >= 0) {
      updates.SIMULATED_AUTHORIZE_DENY_AMOUNT = String(val);
    }
  }

  if (simulated_stepup_amount !== undefined && simulated_stepup_amount !== null) {
    const val = parseFloat(simulated_stepup_amount);
    if (!isNaN(val) && val >= 0) {
      updates.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = String(val);
    }
  }

  if (simulated_consent_types !== undefined && simulated_consent_types !== null) {
    updates.SIMULATED_AUTHORIZE_CONSENT_TYPES = String(simulated_consent_types).trim();
  }

  if (simulated_stepup_types !== undefined && simulated_stepup_types !== null) {
    updates.SIMULATED_AUTHORIZE_STEPUP_TYPES = String(simulated_stepup_types).trim();
  }

  if (simulated_mcp_deny_tools !== undefined && simulated_mcp_deny_tools !== null) {
    updates.SIMULATED_MCP_DENY_TOOLS = String(simulated_mcp_deny_tools).trim();
  }

  if (simulated_mcp_hitl_tools !== undefined && simulated_mcp_hitl_tools !== null) {
    updates.SIMULATED_MCP_HITL_TOOLS = String(simulated_mcp_hitl_tools).trim();
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no_updates', message: 'No valid fields provided to update.' });
  }

  try {
    await configStore.setConfig(updates);
    // Return updated values
    const consentTypesSet = getConsentTypes();
    const stepUpTypesSet = getStepUpTypes();
    const simulated = {
      confirmAmount: getConfirmAmountUsd(),
      denyAmount: getDenyAmountUsd(),
      stepUpAmount: getStepUpAmountUsd(),
      consentTypes: Array.from(consentTypesSet).join(','),
      stepUpTypes: Array.from(stepUpTypesSet).join(','),
      mcpDenyTools: (configStore.get('SIMULATED_MCP_DENY_TOOLS') || '').split(',').filter(Boolean),
      mcpHitlTools: (configStore.get('SIMULATED_MCP_HITL_TOOLS') || '').split(',').filter(Boolean),
    };
    return res.json({
      ok: true,
      message: 'Authorize configuration updated.',
      status: getAuthorizationStatusSummary(),
      simulated,
    });
  } catch (err) {
    console.error('[authorizeConfig/config] Save error:', err.message);
    return res.status(502).json({ error: 'save_failed', message: err.message });
  }
});

module.exports = router;
