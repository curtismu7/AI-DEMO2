'use strict';

/**
 * Fetch tool schemas from the hosted PingOne MCP server (HTTP).
 * Returns the shape runReasonLoop expects.
 */
async function buildAdminToolSchemas() {
  const { listTools } = require('../../services/mcpPingOneHttpAdapter');
  const tools = await listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Execute a PingOne admin tool via the hosted MCP server.
 * Auth is handled inside the adapter with a worker client_credentials token.
 * Returns a JSON-stringified result string (runReasonLoop contract).
 */
async function executeAdminTool(name, args) {
  const { callTool } = require('../../services/mcpPingOneHttpAdapter');
  try {
    const result = await callTool(name, args || {});
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[executeAdminTool] Error calling tool %s: %s', name, err.message);
    return JSON.stringify({ error: 'pingone_mcp_unavailable', message: err.message });
  }
}

module.exports = { buildAdminToolSchemas, executeAdminTool };
