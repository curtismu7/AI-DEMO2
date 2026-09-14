import apiClient from './apiClient';

/**
 * Calls an MCP tool through the standalone, machine-callable PingOne
 * Privilege AI Gateway endpoint (client_credentials, no browser session —
 * demo_api_server/routes/privilegeMcpSimple.js) instead of the banking
 * demo's session-scoped /api/mcp/tool pipeline. This path does NOT run the
 * banking consent/HITL/kill-switch layer — only Privilege's own policy
 * applies. Return shape matches demoAgentService.callMcpTool exactly so
 * callers can swap transports with no other code changes.
 * @param {string} tool
 * @param {object} [params]
 * @param {object} [_opts] - accepted for signature parity, currently unused
 * @returns {Promise<{result: any, tokenEvents: Array}>}
 */
export async function callMcpToolViaPrivilege(tool, params = {}, _opts = {}) {
  const { data } = await apiClient.post('/api/privilege-mcp-simple/tools/call', {
    name: tool,
    arguments: params,
  });
  return { result: data, tokenEvents: [] };
}
