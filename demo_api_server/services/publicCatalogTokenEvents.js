// demo_api_server/services/publicCatalogTokenEvents.js
const { buildTokenEvent } = require('./agentMcpTokenService');

/**
 * Token-chain events for progressive-trust Act 1 (UC24): public catalog tools
 * that Authorize PERMITs without RFC 8693 delegation.
 */
function buildPublicCatalogTokenEvents(toolName = 'get_branch_hours') {
  return [
    buildTokenEvent(
      'token-exchange',
      'RFC 8693 Token Exchange — skipped (public tool)',
      'skipped',
      null,
      'Progressive trust Act 1: public catalog data does not require RFC 8693 delegation. '
        + 'PingOne Authorize PERMITs the read-only tool without minting a delegated MCP token.',
      { rfc: 'RFC 8693', progressiveTrustAct: 1, publicCatalog: true },
    ),
    buildTokenEvent(
      'authorize-decision',
      'PingOne Authorize — Policy Decision (public tool)',
      'active',
      null,
      `Authorize evaluated ${toolName} as a public read-only tool and returned PERMIT — `
        + 'no bearer token or user delegation required.',
      {
        authorizeDecision: 'PERMIT',
        authorizeEngine: 'simulated',
        tool: toolName,
        publicCatalog: true,
        progressiveTrustAct: 1,
      },
    ),
    buildTokenEvent(
      'tool-dispatched',
      `MCP Tool — ${toolName}`,
      'success',
      null,
      `Public catalog tool ${toolName} executed — branch hours returned without token exchange.`,
      { tool: toolName, publicCatalog: true, progressiveTrustAct: 1 },
    ),
  ];
}

module.exports = { buildPublicCatalogTokenEvents };
