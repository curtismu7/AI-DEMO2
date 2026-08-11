/**
 * A killed agent's next MCP tool call must be rejected at the real gate
 * (evaluateMcpFirstToolGate), not just at the kill route's own duplicate-
 * click guard. Before this fix, isAgentRevoked was read nowhere on the
 * actual tool-call path.
 */
jest.mock('../services/killSwitchService', () => ({
  isAgentRevoked: jest.fn(),
}));
jest.mock('../services/delegatedCommerceRuntime', () => ({
  resolveConsentContext: jest.fn(() => null),
}));

const killSwitchService = require('../services/killSwitchService');
const { evaluateMcpFirstToolGate } = require('../services/mcpToolAuthorizationService');

// header.payload.sig — decodeJwtClaims only base64url-decodes, no signature check needed for this test.
function fakeToken(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

describe('evaluateMcpFirstToolGate — kill switch enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a killed agent is blocked with 403 agent_killed, before any PDP work', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(true);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'ai-agent-client-1' });

    const out = await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    expect(out.ran).toBe(true);
    expect(out.block.status).toBe(403);
    expect(out.block.body.error).toBe('agent_killed');
    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('ai-agent-client-1');
  });

  test('an act-delegated token is checked under its actor id, not the subject', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(true);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'end-user-1', act: { sub: 'ai-agent-client-2' } });

    await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('ai-agent-client-2');
  });

  test('a non-killed agent is not blocked by this check', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(false);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'ai-agent-client-1' });

    const out = await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    // Falls through past the kill-check into real gate logic, which requires
    // config this unit test doesn't set up — asserting it did NOT take the
    // kill-check's block branch is the relevant behavior here.
    expect(out.block?.body?.error).not.toBe('agent_killed');
  });

  test('no token short-circuits before the kill-check ever runs', async () => {
    const out = await evaluateMcpFirstToolGate({ req: {}, tool: 'create_transfer', agentToken: null });
    expect(out).toEqual({ ran: false, reason: 'no_agent_token', skipReason: 'no_agent_token' });
    expect(killSwitchService.isAgentRevoked).not.toHaveBeenCalled();
  });
});
