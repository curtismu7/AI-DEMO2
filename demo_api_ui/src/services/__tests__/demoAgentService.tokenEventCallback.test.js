import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track if callback was invoked for debugging
let sseCallbackCalled = false;

vi.mock('../mcpFlowSseClient', () => ({
  openMcpFlowSse: vi.fn((flowTraceId, onEvent) => {
    // Simulate one token-event frame arriving synchronously for testing
    sseCallbackCalled = true;
    onEvent({ type: 'token-event', id: 'tools-list', status: 'success' });
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
  },
}));
vi.mock('../milestonesStore', () => ({
  addMilestone: vi.fn(() => 'milestone-id'),
  updateMilestoneStatus: vi.fn(),
}));
vi.mock('../adminCustomerContext', () => ({
  adminCustomerContext: {
    get: vi.fn(() => null),
  },
}));

import { callMcpTool, sendAgentMessage } from '../demoAgentService';

describe('callMcpTool onTokenEvent callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbackCalled = false;
  });

  it('invokes onTokenEvent for each token-event SSE frame', async () => {
    const onTokenEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ result: {}, tokenEvents: [] }),
    });
    await callMcpTool('get_account_balance', {}, { onTokenEvent });
    expect(sseCallbackCalled).toBe(true);
    expect(onTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tools-list', status: 'success' }),
    );
  });
});

describe('sendAgentMessage onTokenEvent callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbackCalled = false;
  });

  it('invokes onTokenEvent for each token-event SSE frame', async () => {
    const onTokenEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({
        json: async () => ({ success: true, reply: 'test reply' }),
      }),
      json: async () => ({ success: true, reply: 'test reply' }),
    });
    await sendAgentMessage('hello', null, { onTokenEvent });
    expect(sseCallbackCalled).toBe(true);
    expect(onTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tools-list', status: 'success' }),
    );
  });
});
