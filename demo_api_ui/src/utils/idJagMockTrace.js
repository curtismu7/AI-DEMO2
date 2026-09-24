/** Deterministic, token-free teaching fixture. Never copied from a live run. */
export function createMockIdJagTrace() {
  return {
    runId: 'mock-id-jag-001',
    flowTraceId: 'mock-id-jag-001',
    provenance: 'mock-id-jag',
    mode: 'mock-id-jag',
    startedAt: 1700000000000,
    finishedAt: 1700000001000,
    prompt: { message: 'show my balance' },
    routingMode: 'mock-replay',
    routingDetail: null,
    llmDetail: null,
    llmReply: 'Mock replay: the MCP tool returned a sample balance.',
    phases: [],
    tokenEvents: [
      {
        id: 'id-jag-issued',
        label: 'Mock PingFederate issued an ID-JAG',
        status: 'active',
        mock: true,
        claims: {
          iss: 'mock-pingfederate',
          sub: 'mock-demo-user',
          aud: 'mock-mcp-authorization-server',
          scope: 'balance:read',
          jti: 'mock-id-jag-001',
        },
        resource: 'mock-mcp-resource',
      },
      {
        id: 'id-jag-redeemed',
        label: 'Mock MCP authorization server redeemed the ID-JAG',
        status: 'active',
        mock: true,
        claims: {
          iss: 'mock-mcp-authorization-server',
          sub: 'mock-demo-user',
          aud: 'mock-mcp-resource',
          scope: 'balance:read',
        },
        scope: 'balance:read',
      },
    ],
    mcpResult: { tool: 'show_balance', result: { balance: 'Mock balance: 1,234 points' }, mock: true },
    authorize: null,
    authorizeEvaluations: null,
    outcome: 'mock-success',
    approvalOutcome: null,
  };
}
