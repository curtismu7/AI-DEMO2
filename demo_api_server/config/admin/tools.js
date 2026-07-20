'use strict';

/**
 * Tool schemas for the admin agent's LLM. Uses the small
 * list_pingone_tools/call_pingone_tool wrapper (4 tools) instead of the
 * live PingOne MCP server's raw 76-tool catalog (~160KB of JSON schema) --
 * the raw catalog blows past llama.cpp's context window and grammar
 * compiler before the model ever sees the user's message. Same wrapper
 * the pingone-admin vertical's other agent path already uses.
 */
async function buildAdminToolSchemas() {
  const { tools } = require('../verticals/pingone-admin/tools');
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Execute a wrapper tool (list_pingone_tools / call_pingone_tool / demo
 * stubs). Returns a JSON-stringified result string (runReasonLoop contract).
 */
async function executeAdminTool(name, args) {
  const { execute } = require('../verticals/pingone-admin/tools');
  try {
    const { result } = await execute(name, args || {}, {});
    return JSON.stringify(result);
  } catch (err) {
    console.error('[executeAdminTool] Error calling tool %s: %s', name, err.message);
    return JSON.stringify({ error: 'pingone_mcp_unavailable', message: err.message });
  }
}

module.exports = { buildAdminToolSchemas, executeAdminTool };
