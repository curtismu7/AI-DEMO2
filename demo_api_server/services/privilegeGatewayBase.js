'use strict';

// Base URL of the Privilege AI Gateway (origin plus any path prefix), without a
// trailing slash so an app segment can be appended cleanly. Shared by the
// façade's privilege-gateway door (routes/mcpFacade.js) and
// /api/privilege-mcp/facade-link (routes/privilegeMcpClient.js): the link must
// mint its gateway token on the same gateway the door then calls with it.
function privilegeGatewayBase() {
  return String(process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE || 'https://mcpgw.ai-demo.ping-devops.com')
    .replace(/\/+$/, '');
}

module.exports = { privilegeGatewayBase };
