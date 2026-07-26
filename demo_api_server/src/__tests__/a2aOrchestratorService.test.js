'use strict';

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));
jest.mock('../../services/a2aDelegationService', () => ({ delegateToSpecialist: jest.fn() }));

const { callLlamaCpp } = require('../../services/llamacppLlmService');
const { delegateToSpecialist } = require('../../services/a2aDelegationService');
const { orchestrateDelegation } = require('../../services/a2aOrchestratorService');

const reqStub = { session: {} };

function jsonReply(obj) {
  return JSON.stringify(obj);
}

describe('a2aOrchestratorService.orchestrateDelegation — LLM path', () => {
  beforeEach(() => {
    callLlamaCpp.mockReset();
    delegateToSpecialist.mockReset();
  });

  test('single-tool vertical (healthcare): decision + authorization only, no coordinator call, tool auto-picked', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'sensitive record request', sensitivity: 'high' }))
      .mockResolvedValueOnce(jsonReply({ approved: true, blockers: [] }));
    delegateToSpecialist.mockResolvedValue({
      token: 'tok', tokenEvents: [], claims: { act: { sub: 'agent2' } },
      specialist: 'Records Specialist', scopes: ['read'], actChainDepth: 2,
    });

    const result = await orchestrateDelegation({
      req: reqStub, message: 'please pull the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(2); // decision + authorization, coordinator skipped
    expect(delegateToSpecialist).toHaveBeenCalledWith(reqStub, {
      vertical: 'healthcare',
      tool: 'sensitive_patient_records',
      subtask: 'please pull the sensitive patient record',
    });
    expect(result.shouldDelegate).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.specialist).toBe('Records Specialist'); // delegationResult.specialist wins the spread merge
    expect(result.agentHeader).toContain('LLM (llama.cpp)');
  });

  test('multi-tool vertical (banking): all three stages run, coordinator tool reaches delegateToSpecialist', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'investment question', sensitivity: 'medium' }))
      .mockResolvedValueOnce(jsonReply({ tool: 'get_investment_transactions', reasoning: 'user asked about past trades' }))
      .mockResolvedValueOnce(jsonReply({ approved: true, blockers: [] }));
    delegateToSpecialist.mockResolvedValue({
      token: 'tok', tokenEvents: [], claims: {}, specialist: 'Investment Advisor', scopes: ['invest:read'], actChainDepth: 2,
    });

    const result = await orchestrateDelegation({
      req: reqStub, message: 'show me my recent investment transactions', vertical: 'banking', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(3);
    expect(delegateToSpecialist).toHaveBeenCalledWith(reqStub, {
      vertical: 'banking',
      tool: 'get_investment_transactions',
      subtask: 'show me my recent investment transactions',
    });
    expect(result.authorized).toBe(true);
  });

  test('decision stage says no delegation needed: short-circuits before coordinator/authorization', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: false, reason: 'ordinary balance check', sensitivity: 'low' }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'what is my balance', vertical: 'banking', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
    expect(delegateToSpecialist).not.toHaveBeenCalled();
    expect(result.shouldDelegate).toBe(false);
    expect(result.agentHeader).toContain('LLM (llama.cpp)');
  });

  test('authorization stage denies: delegateToSpecialist is never called', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'sensitive record request', sensitivity: 'high' }))
      .mockResolvedValueOnce(jsonReply({ approved: false, blockers: ['insufficient context'] }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'get the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(delegateToSpecialist).not.toHaveBeenCalled();
    expect(result.authorized).toBe(false);
  });
});

describe('a2aOrchestratorService.orchestrateDelegation — heuristic fallback', () => {
  beforeEach(() => {
    callLlamaCpp.mockReset();
    delegateToSpecialist.mockReset();
  });

  test('LLM failure falls back to the keyword heuristic and still resolves specialist correctly', async () => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));
    delegateToSpecialist.mockResolvedValue({
      token: 'tok', tokenEvents: [], claims: {}, specialist: 'Investment Advisor', scopes: ['invest:read'], actChainDepth: 2,
    });

    const result = await orchestrateDelegation({
      req: reqStub, message: 'please escalate to a specialist for my portfolio', vertical: 'banking', userId: 'u1',
    });

    // The pre-existing bug: heuristicOrchestration used to return specialist.id
    // (undefined, since a2aSpecialists entries have no .id), which made
    // specialistForVertical(undefined) return null downstream. Verify the fix:
    // the vertical itself is what's returned, so resolution succeeds.
    expect(delegateToSpecialist).toHaveBeenCalledWith(reqStub, expect.objectContaining({ vertical: 'banking' }));
    expect(result.shouldDelegate).toBe(true);
    expect(result.agentHeader).toContain('Heuristic Fallback');
  });

  test('LLM failure + message with no delegation keywords: heuristic declines, no delegation attempted', async () => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'what is my balance', vertical: 'banking', userId: 'u1',
    });

    expect(delegateToSpecialist).not.toHaveBeenCalled();
    expect(result.shouldDelegate).toBe(false);
    expect(result.agentHeader).toContain('Heuristic Fallback');
  });
});
