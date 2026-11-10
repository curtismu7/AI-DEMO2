import { describe, it, expect, vi } from 'vitest';

vi.mock('../mcpFlowSseClient', () => ({ openMcpFlowSse: vi.fn(() => () => {}) }));
vi.mock('../apiTrafficStore', () => ({
  appendTokenEvents: vi.fn(),
  setCurrentTurn: vi.fn(),
  clearCurrentTurn: vi.fn(),
}));
vi.mock('../apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../agentFlowDiagramService', () => ({
  agentFlowDiagram: { startMcpToolCall: vi.fn(), applyServerEvent: vi.fn(), completeMcpToolCall: vi.fn() },
}));
vi.mock('../tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    beginTrace: vi.fn(),
    bindFlowTrace: vi.fn(),
    ingestRoutingMode: vi.fn(),
    ingestTokenEvents: vi.fn(),
    ingestMcpResult: vi.fn(),
    ingestAuthorize: vi.fn(),
    ingestAuthorizeEvaluations: vi.fn(),
    completeTrace: vi.fn(),
  },
}));
vi.mock('../milestonesStore', () => ({
  addMilestone: vi.fn(() => 'milestone-id'),
  updateMilestoneStatus: vi.fn(),
}));
vi.mock('../adminCustomerContext', () => ({ adminCustomerContext: { get: vi.fn(() => null) } }));

import { buildAuthorizeDecisionEvent, callMcpTool } from '../demoAgentService';

describe('authorize-decision event defaults do not assert what the server did not say', () => {
  it('a missing decision is INDETERMINATE, never PERMIT', () => {
    const ev = buildAuthorizeDecisionEvent({ engine: 'pingone' });
    expect(ev.authorizeDecision).toBe('INDETERMINATE');
    expect(ev.status).toBe('waiting');
    expect(ev.explanation).toMatch(/reported no decision/);
    expect(ev.explanation).not.toMatch(/returned PERMIT/);
  });

  it('a missing engine is "unknown", never "simulated", and the label does not name PingOne', () => {
    const ev = buildAuthorizeDecisionEvent({ decision: 'PERMIT' });
    expect(ev.authorizeEngine).toBe('unknown');
    expect(ev.label).not.toMatch(/PingOne/);
    expect(ev.explanation).not.toMatch(/Simulated/);
    expect(ev.explanation).toMatch(/not reported/);
  });

  it('pingone and simulated engines keep their names', () => {
    const p = buildAuthorizeDecisionEvent({ engine: 'pingone', decision: 'DENY' });
    expect(p.label).toBe('PingOne Authorize — Policy Decision');
    expect(p.status).toBe('failed');
    expect(p.explanation).toBe('PingOne Authorize evaluated the agent tool call and returned DENY.');
    const s = buildAuthorizeDecisionEvent({ engine: 'simulated', decision: 'PERMIT' });
    expect(s.explanation).toBe('Simulated policy engine evaluated the agent tool call and returned PERMIT.');
    expect(s.label).not.toMatch(/PingOne/);
  });

  it('callMcpTool success path with an evaluation that has no decision/engine does not synthesize PERMIT/simulated', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ result: {}, tokenEvents: [], mcpAuthorizeEvaluation: { path: 'x' } }),
    });
    const { tokenEvents } = await callMcpTool('get_my_accounts', {});
    const az = tokenEvents.find((e) => e.id === 'authorize-decision');
    expect(az).toMatchObject({ authorizeDecision: 'INDETERMINATE', authorizeEngine: 'unknown', status: 'waiting' });
  });
});
