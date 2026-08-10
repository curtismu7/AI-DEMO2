'use strict';

/**
 * Fallback (Heuristics) routing must be honored on the pingone-admin vertical.
 *
 * Typed admin chat always routes to processAdminMessage (there is no other
 * path), and before the heuristic-first gate every message rode llama.cpp —
 * so a model refusal ("I'm sorry, but I can't help with that") killed
 * messages the deterministic parser resolves perfectly, filter included.
 *
 * ff_heuristic_enabled=true  → known phrasing dispatches the tool directly,
 *                              the LLM is never invoked.
 * ff_heuristic_enabled=false → LLM-only mode still bypasses the gate.
 */

const FILTERED_RESULT = {
  tool: 'listUsers',
  responseSummary: '1 users found',
  rows: [{ username: 'demoAdmin', email: 'demo@x.test', enabled: true }],
  totalCount: 1,
  source: 'live — hosted PingOne MCP',
};

function loadServiceWithMocks({ heuristicFlag }) {
  jest.resetModules();
  const executeAdminTool = jest.fn().mockResolvedValue(JSON.stringify(FILTERED_RESULT));
  const runReasonLoop = jest.fn().mockResolvedValue({
    finalText: 'llm reply', toolsCalled: [], inputTokens: 0, outputTokens: 0,
  });
  jest.doMock('../config/admin/tools', () => ({
    buildAdminToolSchemas: jest.fn().mockResolvedValue([]),
    executeAdminTool,
  }));
  jest.doMock('../services/agentReasoningClient', () => ({
    runReasonLoop,
    withTruncationNotice: (s) => s,
  }));
  jest.doMock('../services/mcpPingOneHttpAdapter', () => ({
    getWorkerTokenDecoded: jest.fn().mockResolvedValue(null),
  }));
  const realConfigStore = jest.requireActual('../services/configStore');
  jest.doMock('../services/configStore', () => ({
    ...realConfigStore,
    getEffective: (key) =>
      key === 'ff_heuristic_enabled' ? heuristicFlag : realConfigStore.getEffective?.(key) ?? '',
  }));
  const { processAdminMessage } = require('../services/adminAgentService');
  return { processAdminMessage, executeAdminTool, runReasonLoop };
}

describe('admin agent — heuristic-first routing', () => {
  test('known prefix phrasing dispatches the tool without the LLM', async () => {
    const { processAdminMessage, executeAdminTool, runReasonLoop } =
      loadServiceWithMocks({ heuristicFlag: 'true' });

    const res = await processAdminMessage({
      message: 'show all users who start with demo',
      userId: 'u1',
      sessionId: 's1',
      tokenEvents: [],
    });

    expect(runReasonLoop).not.toHaveBeenCalled();
    expect(executeAdminTool).toHaveBeenCalledTimes(1);
    const [action, params] = executeAdminTool.mock.calls[0];
    expect(action).toBe('call_pingone_tool');
    expect(params.name).toBe('listUsers');
    // The filter must survive, case preserved — the refusal this guards
    // against happened on exactly this phrasing.
    expect(params.arguments?.filter).toBe('username sw "demo"');

    expect(res.success).toBe(true);
    expect(res.toolsCalled).toEqual(['call_pingone_tool']);
    expect(res.reply).toContain('demoAdmin');
    expect(res.reply).toContain('1 users found');

    // Same Token Chain visibility contract as the LLM loop
    // (adminAgentService.tokenChainStep.test.js) — a heuristic-routed call
    // must record a step too, or it is invisible in the rail.
    const step = res.tokenEvents.find((e) => e.id === 'pingone-admin-api:call_pingone_tool');
    expect(step).toBeDefined();
    expect(step.status).toBe('success');
  });

  test('a tool-level error records a failed step and falls through to the LLM', async () => {
    const { processAdminMessage, executeAdminTool, runReasonLoop } =
      loadServiceWithMocks({ heuristicFlag: 'true' });
    executeAdminTool.mockResolvedValueOnce(
      JSON.stringify({ error: 'pingone_mcp_unavailable', message: 'PingOne API timeout' }),
    );

    const res = await processAdminMessage({
      message: 'show all users who start with demo',
      userId: 'u1',
      sessionId: 's1',
      tokenEvents: [],
    });

    const step = res.tokenEvents.find((e) => e.id === 'pingone-admin-api:call_pingone_tool');
    expect(step).toBeDefined();
    expect(step.status).toBe('failed');
    expect(step.explanation).toContain('PingOne API timeout');
    // Fallthrough: the model gets a chance to route around the failure.
    expect(runReasonLoop).toHaveBeenCalledTimes(1);
  });

  test('LLM-only mode (flag off) still goes to the model', async () => {
    const { processAdminMessage, executeAdminTool, runReasonLoop } =
      loadServiceWithMocks({ heuristicFlag: 'false' });

    await processAdminMessage({
      message: 'show all users who start with demo',
      userId: 'u1',
      sessionId: 's1',
      tokenEvents: [],
    });

    expect(executeAdminTool).not.toHaveBeenCalled();
    expect(runReasonLoop).toHaveBeenCalledTimes(1);
  });
});
