'use strict';

// These tools are implemented only by the local Node Demo Agent Gateway.
// Every other ordinary vertical tool uses the real PingGateway route.
const DUALTOKEN_TOOLS = new Set(['user_profile_card']);
const BANKINGDATA_TOOLS = new Set(['demo_show_accounts', 'demo_show_transactions']);

function isNodeGatewayOnlyTool(tool) {
  return DUALTOKEN_TOOLS.has(tool) || BANKINGDATA_TOOLS.has(tool);
}

function tokenResolutionOptions(tool, useGateway, hasSuppliedToken) {
  if (!useGateway || hasSuppliedToken) return undefined;
  return isNodeGatewayOnlyTool(tool)
    ? { forceNodeGatewayAudience: true }
    : { forcePingGatewayAudience: true };
}

module.exports = { DUALTOKEN_TOOLS, BANKINGDATA_TOOLS, isNodeGatewayOnlyTool, tokenResolutionOptions };
