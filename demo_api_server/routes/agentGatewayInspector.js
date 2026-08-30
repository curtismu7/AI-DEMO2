'use strict';

/**
 * /api/agent-gateway — gateway introspection and tool invocation for the
 * Agent Gateway Inspector UI.
 *
 *   GET  /capabilities          → list capabilities (tools) for a gateway
 *   POST /invoke                → invoke a tool through the gateway
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/agent-gateway/capabilities?gatewayId=...
 * Returns available capabilities (tools) for the specified gateway.
 */
router.get('/capabilities', async (req, res) => {
  const { gatewayId } = req.query;

  if (!gatewayId) {
    return res.status(400).json({ error: 'gatewayId is required' });
  }

  try {
    // Map gateway IDs to their tool sets
    const gatewayTools = {
      'demo-mcp-gateway': [
        // Banking domain tools
        { name: 'get_accounts', description: 'List user bank accounts and balances' },
        { name: 'get_account_details', description: 'Get detailed account information' },
        { name: 'get_transactions', description: 'Retrieve transaction history' },
        { name: 'transfer_funds', description: 'Execute fund transfer between accounts' },
        { name: 'get_transfer_limits', description: 'Get account transfer limits' },
        { name: 'get_card_details', description: 'Retrieve card information' },
        { name: 'block_card', description: 'Block a debit or credit card' },
        { name: 'get_loan_details', description: 'Get loan account information' },
        { name: 'calculate_loan_payment', description: 'Calculate loan payment schedule' },
        // Code/repo tools
        { name: 'list_repositories', description: 'List available code repositories' },
        { name: 'read_file', description: 'Read and display file contents' },
        { name: 'search_code', description: 'Search code across repositories' },
        { name: 'get_repo_issues', description: 'List repository issues and PRs' },
        { name: 'get_commit_history', description: 'Get repository commit history' },
      ],
      'privilege-gateway': [
        // PingOne Authorization (P1AZ) tools
        { name: 'evaluate_policy', description: 'Evaluate PingOne authorization policy decision' },
        { name: 'get_policies', description: 'List available PingOne authorization policies' },
        { name: 'get_policy_details', description: 'Get details of a specific policy' },
        { name: 'check_permission', description: 'Check if user has specific permission' },
        { name: 'get_user_permissions', description: 'Get all permissions for a user' },
        { name: 'get_role_permissions', description: 'Get permissions for a role' },
        // PingOne Admin tools
        { name: 'list_applications', description: 'List PingOne applications' },
        { name: 'read_user', description: 'Read user profile and details' },
        { name: 'list_users', description: 'List users in PingOne directory' },
        { name: 'create_user', description: 'Create a new user in PingOne' },
        { name: 'update_user', description: 'Update user attributes' },
        { name: 'delete_user', description: 'Delete a user from PingOne' },
        { name: 'get_user_groups', description: 'Get groups a user belongs to' },
        { name: 'list_groups', description: 'List all groups in directory' },
        { name: 'get_user_roles', description: 'Get roles assigned to a user' },
        { name: 'get_audit_logs', description: 'Retrieve PingOne audit logs' },
        { name: 'get_enrollment_status', description: 'Check user enrollment status (MFA, passwordless)' },
      ],
      'external-door': [
        { name: 'oauth_provider_config', description: 'Get OAuth provider configuration' },
        { name: 'token_exchange', description: 'Exchange tokens (RFC 8693)' },
        { name: 'introspect_token', description: 'Introspect OAuth token validity and scope' },
        { name: 'revoke_token', description: 'Revoke an OAuth token' },
        { name: 'get_scopes', description: 'List available OAuth scopes' },
        { name: 'get_audience', description: 'Get configured resource audience' },
      ],
    };

    const capabilities = gatewayTools[gatewayId] || [];
    res.json({ capabilities });
  } catch (err) {
    console.error('Failed to fetch capabilities:', err);
    res.status(500).json({ error: 'Failed to fetch capabilities' });
  }
});

/**
 * POST /api/agent-gateway/invoke
 * Invokes a tool through the specified gateway.
 */
router.post('/invoke', express.json(), async (req, res) => {
  const { gatewayId, tool, parameters = {} } = req.body;

  if (!gatewayId || !tool) {
    return res.status(400).json({ error: 'gatewayId and tool are required' });
  }

  try {
    const startTime = Date.now();

    // Mock implementation: simulate tool invocation
    // In production, this would route through the actual MCP gateway
    const toolResults = {
      'get_accounts': {
        message: 'Retrieved user bank accounts',
        data: [
          { id: 'acc-001', name: 'Checking', balance: 5234.56 },
          { id: 'acc-002', name: 'Savings', balance: 25000.00 },
        ],
      },
      'evaluate_policy': {
        message: 'Policy decision evaluated',
        data: {
          decision: 'PERMIT',
          policy: 'banking-transfer-policy',
          reason: 'User has transfer permission',
        },
      },
      'get_user_permissions': {
        message: 'User permissions retrieved',
        data: [
          { resource: 'accounts', actions: ['read', 'list'] },
          { resource: 'transfers', actions: ['read', 'create'] },
          { resource: 'cards', actions: ['read', 'block'] },
        ],
      },
      'default': {
        message: `Successfully invoked ${tool} on ${gatewayId}`,
        data: {
          timestamp: new Date().toISOString(),
          executedAt: gatewayId,
          parameters,
        },
      },
    };

    const output = toolResults[tool] || toolResults.default;

    const result = {
      status: 'success',
      durationMs: Math.random() * 500 + 100,
      tool,
      gatewayId,
      parameters,
      output,
      trace: {
        steps: [
          {
            step: 1,
            action: 'route_to_gateway',
            gateway: gatewayId,
            status: 'success',
          },
          {
            step: 2,
            action: 'invoke_tool',
            tool,
            status: 'success',
            durationMs: Math.random() * 300 + 50,
          },
          {
            step: 3,
            action: 'format_response',
            status: 'success',
            durationMs: 5,
          },
        ],
      },
    };

    res.json(result);
  } catch (err) {
    console.error('Failed to invoke tool:', err);
    res.status(500).json({
      error: 'Failed to invoke tool',
      message: err.message,
    });
  }
});

module.exports = router;
