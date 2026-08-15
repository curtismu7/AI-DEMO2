import { MCPMessageHandler } from '../MCPMessageHandler';

/**
 * MCP_AUTH_DISABLED is ONE env var shared by two gateways that reach the same
 * mcp-server:
 *
 *   nginx :443 -> ping-mcpgw :8623 -> mcp-server :8080   (Privilege: authorizes
 *       upstream, sends no bearer this server can validate — the mode exists
 *       for this hop)
 *   PingGateway :3036 -> mcp-server :8080                (banking: mints an
 *       RFC 8693 Exchange #3 token for mcpserver.ping.demo and forwards it)
 *
 * Because it was read as a global, enabling it for the first hop changed the
 * answer for the second. These tests pin the per-hop split: the bypass follows
 * the REQUEST (context.openAccess, set only when the transport admitted a
 * tokenless caller), never the environment.
 */
describe('open access is per-hop, not per-process', () => {
  const tool = {
    name: 'get_my_accounts',
    description: 'read accounts',
    requiredScopes: ['read'],
    inputSchema: { type: 'object', properties: {}, required: [] },
  };

  const session = {
    sessionId: 's1',
    agentTokenHash: 'h',
    createdAt: new Date(),
    lastActivity: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  };

  /** Counts scope-gate consultations. The gate always denies, so a successful
   *  tool call proves it was SKIPPED rather than that it happened to agree. */
  let scopeChecks: number;

  const makeHandler = () => {
    scopeChecks = 0;
    const authManager = {
      validateTokenScopes: async () => { scopeChecks += 1; return false; },
      validateAgentToken: async () => ({ isValid: true, scopes: [] }),
    };
    const sessionManager = {
      getSession: async () => session,
      createSession: async () => session,
      getSessionEmail: () => undefined,
      updateSessionActivity: async () => undefined,
      validateSession: async () => session,
    };
    const toolProvider = {
      getAvailableTools: () => [tool],
      executeTool: async () => ({ success: true, text: 'ok' }),
    };
    return new MCPMessageHandler(
      authManager as never,
      sessionManager as never,
      toolProvider as never
    );
  };

  const call = () => ({
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/call',
    params: { name: 'get_my_accounts', arguments: {} },
  });

  afterEach(() => { delete process.env.MCP_AUTH_DISABLED; });

  it('skips the scope gate for a tokenless open-access hop', async () => {
    const res: unknown = await makeHandler().handleMessage(call() as never, {
      connectionId: 'c1',
      session: session as never,
      agentToken: 'disabled',
      openAccess: true,
    } as never);

    expect(scopeChecks).toBe(0);
    expect((res as { error?: unknown })?.error).toBeUndefined();
  });

  // The other half of the split — a token-bearing caller is still enforced while
  // the env var is ON — is asserted directly against the gate in
  // authDisabledKeepsBearer.test.ts. Asserting it a second time through the
  // whole handler only re-tests the stub, so it lives at the one level where it
  // is actually about the scope decision.
});
