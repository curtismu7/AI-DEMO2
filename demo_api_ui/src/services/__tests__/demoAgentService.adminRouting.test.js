import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../mcpFlowSseClient', () => ({ openMcpFlowSse: vi.fn(() => () => {}) }));
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
  adminCustomerContext: { get: vi.fn(() => null) },
}));

import { sendAgentMessage } from '../demoAgentService';
import * as mcpFlowModule from '../mcpFlowSseClient';

describe('sendAgentMessage — pingone-admin vertical routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to /api/admin-agent/message instead of /api/agent/invoke', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'admin reply', success: true, tokenEvents: [] }),
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin-agent/message');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ message: 'list applications', customer: null });
    expect(result).toMatchObject({ reply: 'admin reply', success: true, requiresConsent: false, _status: 200 });
  });

  it('passes through agentHeader so the UI can label the reply correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'admin reply',
        success: true,
        tokenEvents: [],
        agentHeader: '🤖 [ADMIN AGENT - LangGraph - Claude 3.5 Sonnet]',
      }),
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(result.agentHeader).toBe('🤖 [ADMIN AGENT - LangGraph - Claude 3.5 Sonnet]');
  });

  it('passes through error so a 403 insufficient_scope response is distinguishable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'insufficient_scope',
        error_description: 'Admin access required. User must have admin role or admin scope.',
      }),
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(result.error).toBe('insufficient_scope');
    expect(result._status).toBe(403);
  });

  it('does not open the SSE flow-trace connection for the admin path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'admin reply', success: true, tokenEvents: [] }),
    });
    await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(vi.mocked(mcpFlowModule.openMcpFlowSse)).not.toHaveBeenCalled();
  });

  it('fires onTokenEvent once per item in the batched tokenEvents array', async () => {
    const onTokenEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'admin reply',
        success: true,
        tokenEvents: [{ id: 'a' }, { id: 'b' }],
      }),
    });
    await sendAgentMessage('list applications', null, { vertical: 'pingone-admin', onTokenEvent });
    expect(onTokenEvent).toHaveBeenCalledTimes(2);
    expect(onTokenEvent).toHaveBeenNthCalledWith(1, { id: 'a' });
    expect(onTokenEvent).toHaveBeenNthCalledWith(2, { id: 'b' });
  });

  it('falls back to a generic failure reply on unparseable JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
    });
    const result = await sendAgentMessage('list applications', null, { vertical: 'pingone-admin' });
    expect(result).toMatchObject({ reply: 'Admin agent request failed.', success: false });
  });

  it('still routes non-admin verticals through /api/agent/invoke unchanged', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ json: async () => ({ success: true, reply: 'banking reply' }) }),
      json: async () => ({ success: true, reply: 'banking reply' }),
    });
    const result = await sendAgentMessage('show my balance', null, { vertical: 'banking' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/agent/invoke');
    expect(result.reply).toBe('banking reply');
  });
});
