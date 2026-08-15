import { AuthenticationIntegration } from '../AuthenticationIntegration';

/**
 * MCP_AUTH_DISABLED means "the gateway in front of this server owns
 * authorization". It used to hand a placeholder string ('disabled') downstream
 * as the agent token, so every per-tool scope check decoded it, failed with
 * "Malformed JWT", and answered -32005 insufficient_scope — the flag that
 * disables auth denied every scoped tool call, including calls PingOne
 * Authorize had already PERMITted at the gateway.
 *
 * The first fix let THIS class waive the scope check whenever the env var was
 * set. That waiver could not tell the two gateways apart: one switch is shared
 * by the Privilege hop (which sends no token we can validate) and the banking
 * hop (which sends a real, fully scoped one), so turning it on for Privilege
 * also stopped enforcing scopes on banking.
 *
 * The waiver now lives where the difference is observable — HttpMCPTransport
 * marks a tokenless admission as openAccess and MCPMessageHandler skips this
 * call for it. So the contract HERE is simple and unconditional: whatever
 * reaches this method presented a token and is judged on that token's scopes,
 * with or without the env var.
 */
describe('AuthenticationIntegration — scope enforcement does not read the open-access env var', () => {
  const session = { sessionId: 's1' };

  /** authManager stub: 'disabled' is not a JWT, exactly as the real decode sees it. */
  const authManager = {
    validateTokenScopes: async (token: string, required: string[]) => {
      if (token === 'disabled') return false; // Malformed JWT → false
      const held = token === 'real-token' ? ['read', 'write'] : [];
      return required.every((s) => held.includes(s));
    },
    validateAgentToken: async () => ({ isValid: true, scopes: ['read', 'write'] }),
  };
  const sessionManager = { getSession: () => session };

  const integration = () =>
    new AuthenticationIntegration(authManager as never, sessionManager as never);

  afterEach(() => { delete process.env.MCP_AUTH_DISABLED; });

  it('denies an under-scoped token even when open access is ON — the flag must not disarm the other gateway', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    const res = await integration().validateToolAuthentication(session as never, 'disabled', ['write']);
    expect(res.success).toBe(false);
    expect(res.insufficientScope).toBe(true);
  });

  it('still denies an under-scoped token when open access is OFF', async () => {
    const res = await integration().validateToolAuthentication(session as never, 'disabled', ['write']);
    expect(res.success).toBe(false);
    expect(res.insufficientScope).toBe(true);
  });

  it('permits a properly scoped token with open access off — the normal path is untouched', async () => {
    const res = await integration().validateToolAuthentication(session as never, 'real-token', ['write']);
    expect(res.success).toBe(true);
  });

  it('permits a properly scoped token with open access ON — the mode changes nothing for real tokens', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    const res = await integration().validateToolAuthentication(session as never, 'real-token', ['write']);
    expect(res.success).toBe(true);
  });
});
