// The chat path (sendAgentMessage) streams MCP tool results as `mcp-result`
// frames. The chip path and useAgentRun forward those to the trace store as
// `mcp-tool-result-sse`; the chat path did not, so a chat run's API step never
// saw a result. This pins the forward, and that it carries THIS run's flow id —
// the store drops a result whose flow id belongs to a different run.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../mcpFlowSseClient', () => ({
  openMcpFlowSse: vi.fn((flowTraceId, onEvent) => {
    onEvent({ type: 'mcp-result', toolName: 'get_my_accounts', result: { accounts: 2 } });
    return () => {};
  }),
}));
vi.mock('../apiTrafficStore', () => ({
  appendTokenEvents: vi.fn(),
  setCurrentTurn: vi.fn(),
  clearCurrentTurn: vi.fn(),
}));
vi.mock('../apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../agentFlowDiagramService', () => ({
  agentFlowDiagram: {
    startMcpToolCall: vi.fn(),
    applyServerEvent: vi.fn(),
    completeMcpToolCall: vi.fn(),
  },
}));
vi.mock('../tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    beginTrace: vi.fn(),
    ingestRoutingMode: vi.fn(),
    ingestTokenEvents: vi.fn(),
    ingestMcpResult: vi.fn(),
    ingestAuthorize: vi.fn(),
    ingestLlmDetail: vi.fn(),
    ingestLlmReply: vi.fn(),
    completeTrace: vi.fn(),
    getState: vi.fn(() => ({ trace: { tokenEvents: [], mcpResult: null } })),
  },
}));
vi.mock('../milestonesStore', () => ({
  addMilestone: vi.fn(() => 'milestone-id'),
  updateMilestoneStatus: vi.fn(),
}));
vi.mock('../adminCustomerContext', () => ({
  adminCustomerContext: { get: vi.fn(() => null) },
}));

import { sendAgentMessage } from '../demoAgentService';

describe('sendAgentMessage forwards streamed MCP results', () => {
  let seen;
  const onResult = (e) => { seen.push(e.detail); };

  beforeEach(() => {
    vi.clearAllMocks();
    seen = [];
    window.addEventListener('mcp-tool-result-sse', onResult);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ json: async () => ({ success: true, reply: 'ok' }) }),
      json: async () => ({ success: true, reply: 'ok' }),
    });
  });

  afterEach(() => {
    window.removeEventListener('mcp-tool-result-sse', onResult);
  });

  it('dispatches mcp-tool-result-sse for an mcp-result frame, tagged with this run', async () => {
    await sendAgentMessage('show my accounts', null, {});

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'mcp-result',
      toolName: 'get_my_accounts',
      result: { accounts: 2 },
    });

    const invoke = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/agent/invoke'));
    const sent = JSON.parse(invoke[1].body);
    expect(seen[0].flowTraceId).toBe(sent.flowTraceId);
  });
});
