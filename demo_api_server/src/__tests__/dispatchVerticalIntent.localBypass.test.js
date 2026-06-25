'use strict';

// Stub heavy transitive deps so this test runs in a worktree (no node_modules symlink).
jest.mock('../../services/agentBuilder', () => ({
  getBankingToolDefinitions: jest.fn(() => []),
  MAX_TOOL_ITERATIONS: 5,
}));
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(),
}));
jest.mock('../../services/verticalMcpExecution', () => ({
  executePluginToolViaMcp: jest.fn(),
  checkLocalAuthzGate: jest.fn(),
}));
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(),
  buildTokenEvent: jest.fn(),
}));
jest.mock('../../services/appEventService', () => ({ emit: jest.fn() }));
jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(),
  buildCatalogMessage: jest.fn(),
  resolveVerticalRouting: jest.fn(),
}));
jest.mock('../../services/agentModeResolver', () => ({ resolveAgentMode: jest.fn() }));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  get: jest.fn(() => null),
}));
jest.mock('../../config/runtimeSettings', () => ({}));
jest.mock('../../data/store', () => ({}));
jest.mock('../../middleware/delegationAuditLogger', () => ({ logDelegationEvent: jest.fn() }));
jest.mock('../../services/verticalManifest', () => ({ verticalManifest: {} }));
jest.mock('../../services/mcpToolAuditStore', () => ({ recordToolCall: jest.fn() }));
jest.mock('../../utils/mcpToolRegistry', () => ({
  callMcpToolInternal: jest.fn(),
  createMcpToolRegistry: jest.fn(() => []),
}));
// Stub npm packages not available in the worktree (no node_modules symlink).
jest.mock('zod', () => ({ object: jest.fn(() => ({ parse: jest.fn() })), string: jest.fn(), optional: jest.fn() }), { virtual: true });
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })) }), { virtual: true });

// Mock verticalDispatch so we can inject a plugin with a local tool.
jest.mock('../../services/verticalDispatch', () => ({
  resolvePlugin: jest.fn(),
  toolSchemasFor: jest.fn(() => []),
}));
// agentPreflightService must NOT be called for a local tool.
jest.mock('../../services/agentPreflightService', () => ({
  evaluate: jest.fn(() => { throw new Error('preflight should not run for local tools'); }),
}));

const verticalDispatch = require('../../services/verticalDispatch');
const { dispatchVerticalIntent } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent — local-tool bypass', () => {
  it('runs a local tool directly without authz pre-flight or MCP', async () => {
    const executeTool = jest.fn(async () => ({
      result: { text: 'Token exchange swaps one token for another (RFC 8693).', education: { panel: 'token-exchange', tab: null } },
      render: 'text',
    }));
    verticalDispatch.resolvePlugin.mockReturnValue({
      isLocalTool: (n) => n === 'explain_concept',
      executeTool,
      getHeuristics: () => [],
    });

    const res = await dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'explain_concept', params: { topic: 'token exchange' } },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );

    expect(executeTool).toHaveBeenCalledWith('explain_concept', { topic: 'token exchange' }, expect.any(Object));
    expect(res.success).toBe(true);
    expect(res.reply).toMatch(/RFC 8693/);
    expect(res.education).toEqual({ panel: 'token-exchange', tab: null });
    expect(res.toolsCalled).toEqual(['explain_concept']);
  });

  it('attaches a verticalResult for a non-text render + holds the envelope contract', async () => {
    const data = { t1: { payload: { sub: 'u-1' } }, t2: null };
    verticalDispatch.resolvePlugin.mockReturnValue({
      isLocalTool: (n) => n === 'inspect_token',
      executeTool: jest.fn(async () => ({ result: data, render: 'token_pair' })),
      getHeuristics: () => [],
    });

    const res = await dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'inspect_token', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );

    expect(res.success).toBe(true);
    expect(res.verticalResult).toEqual({ action: 'inspect_token', render: 'token_pair', data });
    expect(res.requiresConsent).toBe(false);
    expect(res.agentConfigured).toBe(true);
  });

  it('omits verticalResult for a text render', async () => {
    verticalDispatch.resolvePlugin.mockReturnValue({
      isLocalTool: (n) => n === 'explain_concept',
      executeTool: jest.fn(async () => ({ result: { text: 'hi' }, render: 'text' })),
      getHeuristics: () => [],
    });

    const res = await dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'explain_concept', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );

    expect(res.success).toBe(true);
    expect(res.verticalResult).toBeUndefined();
  });

  it('surfaces a failure (success:false, ❌ reply) when a local tool throws', async () => {
    verticalDispatch.resolvePlugin.mockReturnValue({
      isLocalTool: (n) => n === 'explain_concept',
      executeTool: jest.fn(async () => { throw new Error('boom'); }),
      getHeuristics: () => [],
    });

    const res = await dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'explain_concept', params: { topic: 'x' } },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );

    expect(res.success).toBe(false);
    expect(res.reply).toMatch(/^❌/);
    expect(res.reply).toMatch(/boom/);
    expect(res.toolsCalled).toEqual(['explain_concept']);
  });
});
