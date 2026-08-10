import { AuthenticationIntegration } from '../AuthenticationIntegration';

/**
 * MCP_AUTH_DISABLED means "the caller in front of this server owns
 * authorization". It used to hand a placeholder string ('disabled') downstream
 * as the agent token, so every per-tool scope check decoded it, failed with
 * "Malformed JWT", and answered -32005 insufficient_scope — the flag that
 * disables auth denied every scoped tool call, including calls PingOne
 * Authorize had already PERMITted at the gateway.
 */
describe('AuthenticationIntegration — open-access mode must not deny on scope', () => {
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

  it('permits the tool call when open access is on and the bearer carries no usable scopes', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    const res = await integration().validateToolAuthentication(session as never, 'disabled', ['write']);
    expect(res.success).toBe(true);
    expect(res.insufficientScope).toBeUndefined();
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
});
