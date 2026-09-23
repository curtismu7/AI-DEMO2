'use strict';

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));
jest.mock('../../services/demoAgentLangGraphService', () => ({ executeA2aDelegation: jest.fn() }));

const { callLlamaCpp } = require('../../services/llamacppLlmService');
let { executeA2aDelegation } = require('../../services/demoAgentLangGraphService');
const { orchestrateDelegation } = require('../../services/a2aOrchestratorService');

const reqStub = { session: {} };

function jsonReply(obj) {
  return JSON.stringify(obj);
}

describe('a2aOrchestratorService.orchestrateDelegation — LLM path', () => {
  beforeEach(() => {
    callLlamaCpp.mockReset();
    executeA2aDelegation = require('../../services/demoAgentLangGraphService').executeA2aDelegation;
    executeA2aDelegation.mockReset();
  });

  test('single-tool vertical (healthcare): decision only, no coordinator call, tool auto-picked', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'sensitive record request', sensitivity: 'high' }));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({
      delegated: true, specialist: 'Records Specialist', tool: 'sensitive_patient_records',
      scopes: ['read'], actChainDepth: 2, result: { record: 'redacted-test-data' }, toolError: null,
    }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'please pull the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(1); // decision only — coordinator skipped, no authorization stage exists
    expect(executeA2aDelegation).toHaveBeenCalledWith('healthcare', expect.objectContaining({
      tool: 'sensitive_patient_records', subtask: 'please pull the sensitive patient record',
    }), expect.objectContaining({ req: reqStub }));
    expect(result.shouldDelegate).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.specialist).toBe('Records Specialist'); // delegationResult.specialist wins the spread merge
    expect(result.actChainDepth).toBe(2);
    expect(result.result).toEqual({ record: 'redacted-test-data' });
    expect(result.success).toBe(true);
    expect(result.token).toBeUndefined();
    expect(result.agentHeader).toContain('LLM (llama.cpp)');
  });

  test('multi-tool vertical (banking): both stages run, coordinator tool reaches delegateToSpecialist', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'investment question', sensitivity: 'medium' }))
      .mockResolvedValueOnce(jsonReply({ tool: 'get_investment_transactions', reasoning: 'user asked about past trades' }));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({
      delegated: true, specialist: 'Investment Advisor', tool: 'get_investment_transactions',
      scopes: ['invest:read'], actChainDepth: 2, result: [], toolError: null,
    }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'show me my recent investment transactions', vertical: 'banking', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(2); // decision + coordinator
    expect(executeA2aDelegation).toHaveBeenCalledWith('banking', expect.objectContaining({
      tool: 'get_investment_transactions', subtask: 'show me my recent investment transactions',
    }), expect.objectContaining({ req: reqStub }));
    expect(result.authorized).toBe(true);
  });

  test('decision stage says no delegation needed: short-circuits before coordinator/authorization', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: false, reason: 'ordinary balance check', sensitivity: 'low' }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'what is my balance', vertical: 'banking', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
    expect(executeA2aDelegation).not.toHaveBeenCalled();
    expect(result.shouldDelegate).toBe(false);
    expect(result.agentHeader).toContain('LLM (llama.cpp)');
  });

  // RED PROOF for 2026-08-29: there is no predictive authorization stage.
  // It asked the model whether PingOne Authorize would approve and blocked the
  // delegation on that guess; on the live tier the guess was 'no' 4 times out of
  // 4, so this route never delegated. Authorization is the PDP's answer, made for
  // real one hop later inside a2aDelegationService.
  test('no authorization stage: a third LLM reply is never requested and cannot block delegation', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'sensitive record request', sensitivity: 'high' }))
      // If a reviewer stage were reinstated it would consume this reply and refuse.
      .mockResolvedValueOnce(jsonReply({ approved: false, blockers: ['insufficient context'] }));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({ delegated: true, tool: 'sensitive_patient_records', actChainDepth: 2, toolError: null }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'get the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
    expect(executeA2aDelegation).toHaveBeenCalled();
    expect(result.authorized).toBe(true);
    // and the reason must describe what actually happened, not claim approval
    expect(result.reason).not.toContain('Delegation approved');
    expect(result.reason).toContain('PingOne Authorize decides');
  });

  test('depth-one delegation is incomplete and token-shaped helper fields are discarded', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'passenger record', sensitivity: 'high' }));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({
      delegated: true,
      specialist: 'Passenger Records Specialist',
      tool: 'sensitive_passenger_record',
      actChainDepth: 1,
      result: null,
      token: 'must-not-escape',
      claims: { sub: 'must-not-escape-either' },
    }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'delegate this to a specialist', vertical: 'airlines', userId: 'u1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_a2a_act_chain_depth');
    expect(result.actChainDepth).toBe(1);
    expect(result.token).toBeUndefined();
    expect(result.claims).toBeUndefined();
  });
});

describe('a2aOrchestratorService.orchestrateDelegation — heuristic fallback', () => {
  beforeEach(() => {
    callLlamaCpp.mockReset();
    executeA2aDelegation = require('../../services/demoAgentLangGraphService').executeA2aDelegation;
    executeA2aDelegation.mockReset();
  });

  test('LLM failure falls back to the keyword heuristic and still resolves specialist correctly', async () => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({ delegated: true, actChainDepth: 2, toolError: null }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'please escalate to a specialist for my portfolio', vertical: 'banking', userId: 'u1',
    });

    // The pre-existing bug: heuristicOrchestration used to return specialist.id
    // (undefined, since a2aSpecialists entries have no .id), which made
    // specialistForVertical(undefined) return null downstream. Verify the fix:
    // the vertical itself is what's returned, so resolution succeeds.
    expect(executeA2aDelegation).toHaveBeenCalledWith('banking', expect.any(Object), expect.objectContaining({ req: reqStub }));
    expect(result.shouldDelegate).toBe(true);
    expect(result.agentHeader).toContain('Heuristic Fallback');
  });

  test.each([
    ['healthcare', 'access my sensitive patient records'],
    ['government', 'access my sensitive tax record'],
    ['workforce', 'access my sensitive payroll details'],
    ['retail', 'access my sensitive order history'],
  ])('LLM failure still delegates the catalog UC2 prompt for %s', async (vertical, message) => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({ delegated: true, actChainDepth: 2, toolError: null }));

    const result = await orchestrateDelegation({ req: reqStub, message, vertical, userId: 'u1' });

    expect(executeA2aDelegation).toHaveBeenCalledWith(vertical, expect.objectContaining({ subtask: message }), expect.objectContaining({ req: reqStub }));
    expect(result.shouldDelegate).toBe(true);
    expect(result.authorized).toBe(true);
  });

  test('LLM failure + message with no delegation keywords: heuristic declines, no delegation attempted', async () => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'what is my balance', vertical: 'banking', userId: 'u1',
    });

    expect(executeA2aDelegation).not.toHaveBeenCalled();
    expect(result.shouldDelegate).toBe(false);
    expect(result.agentHeader).toContain('Heuristic Fallback');
  });
});
