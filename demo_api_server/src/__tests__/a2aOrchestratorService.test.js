'use strict';

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));
jest.mock('../../services/demoAgentLangGraphService', () => ({ executeA2aDelegation: jest.fn() }));

const { callLlamaCpp } = require('../../services/llamacppLlmService');
let { executeA2aDelegation } = require('../../services/demoAgentLangGraphService');
const { orchestrateDelegation } = require('../../services/a2aOrchestratorService');

const configStore = require('../../services/configStore');

const reqStub = { session: {} };

// configStore's default agent_mode is 'heuristics'; the suites below exercise the
// LLM brain unless they override it.
beforeEach(() => {
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => (k === 'agent_mode' ? 'llamacpp' : undefined));
});
afterEach(() => jest.restoreAllMocks());

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

describe('a2aOrchestratorService.orchestrateDelegation — UI agent mode', () => {
  let spy;
  beforeEach(() => {
    callLlamaCpp.mockReset();
    executeA2aDelegation = require('../../services/demoAgentLangGraphService').executeA2aDelegation;
    executeA2aDelegation.mockReset();
    executeA2aDelegation.mockResolvedValue(JSON.stringify({ delegated: true, actChainDepth: 2, toolError: null }));
    spy = configStore.getEffective;
  });

  test('Heuristics mode never calls the model and labels the header "Heuristics"', async () => {
    spy.mockImplementation((k) => (k === 'agent_mode' ? 'heuristics' : undefined));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'access my sensitive patient records', vertical: 'healthcare', userId: 'u1',
    });

    expect(callLlamaCpp).not.toHaveBeenCalled();
    expect(result.shouldDelegate).toBe(true);
    expect(result.agentHeader).toBe('[A2A ORCHESTRATOR - Heuristics]');
  });

  test('llama.cpp mode still tries the LLM first', async () => {
    spy.mockImplementation((k) => (k === 'agent_mode' ? 'llamacpp' : undefined));
    callLlamaCpp.mockResolvedValueOnce(JSON.stringify({ shouldDelegate: true, reason: 'r', sensitivity: 'high' }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'access my sensitive patient records', vertical: 'healthcare', userId: 'u1',
    });

    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
    expect(result.agentHeader).toContain('LLM (llama.cpp)');
  });

  test('per-request mode beats the global agent_mode, both ways', async () => {
    spy.mockImplementation((k) => (k === 'agent_mode' ? 'llamacpp' : undefined));
    await orchestrateDelegation({
      req: reqStub, message: 'access my sensitive patient records', vertical: 'healthcare', userId: 'u1', mode: 'heuristics',
    });
    expect(callLlamaCpp).not.toHaveBeenCalled();

    spy.mockImplementation((k) => (k === 'agent_mode' ? 'heuristics' : undefined));
    callLlamaCpp.mockResolvedValueOnce(JSON.stringify({ shouldDelegate: true, reason: 'r', sensitivity: 'high' }));
    await orchestrateDelegation({
      req: reqStub, message: 'access my sensitive patient records', vertical: 'healthcare', userId: 'u1', mode: 'llm',
    });
    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
  });
});

describe('a2aOrchestratorService.orchestrateDelegation — per-stage timings', () => {
  const delegated = (specialist, tool) => JSON.stringify({
    delegated: true, specialist, tool, scopes: ['read'], actChainDepth: 2, result: {}, toolError: null,
  });
  const sumMs = (t) => t.stages.reduce((n, s) => n + s.ms, 0);

  beforeEach(() => {
    callLlamaCpp.mockReset();
    executeA2aDelegation = require('../../services/demoAgentLangGraphService').executeA2aDelegation;
    executeA2aDelegation.mockReset();
  });

  test('multi-tool vertical: decision, coordinator and specialist are timed; total is their sum', async () => {
    callLlamaCpp
      .mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'r', sensitivity: 'low' }))
      .mockResolvedValueOnce(jsonReply({ tool: 'get_investment_transactions', reasoning: 'r' }));
    executeA2aDelegation.mockResolvedValue(delegated('Investment Advisor', 'get_investment_transactions'));

    const { timings } = await orchestrateDelegation({
      req: reqStub, message: 'show me my recent investment transactions', vertical: 'banking', userId: 'u1',
    });

    expect(timings.stages.map((s) => s.stage)).toEqual(['decision', 'coordinator', 'specialist']);
    expect(timings.stages.every((s) => Number.isFinite(s.ms) && s.ms >= 0 && s.agent)).toBe(true);
    expect(timings.totalMs).toBe(sumMs(timings));
  });

  test('single-tool vertical has no coordinator stage', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'r', sensitivity: 'high' }));
    executeA2aDelegation.mockResolvedValue(delegated('Records Specialist', 'sensitive_patient_records'));

    const { timings } = await orchestrateDelegation({
      req: reqStub, message: 'pull the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(timings.stages.map((s) => s.stage)).toEqual(['decision', 'specialist']);
    expect(timings.totalMs).toBe(sumMs(timings));
  });

  test('no delegation: only the decision stage is reported (the not-approved response still carries timings)', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: false, reason: 'chit-chat', sensitivity: 'low' }));

    const { timings } = await orchestrateDelegation({
      req: reqStub, message: 'hello there', vertical: 'banking', userId: 'u1',
    });

    expect(timings.stages.map((s) => s.stage)).toEqual(['decision']);
    expect(timings.totalMs).toBe(sumMs(timings));
    expect(executeA2aDelegation).not.toHaveBeenCalled();
  });

  test('a failed specialist execution still reports the time spent on it', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ shouldDelegate: true, reason: 'r', sensitivity: 'high' }));
    executeA2aDelegation.mockResolvedValue(JSON.stringify({ delegated: false, error: 'boom' }));

    const result = await orchestrateDelegation({
      req: reqStub, message: 'pull the sensitive patient record', vertical: 'healthcare', userId: 'u1',
    });

    expect(result.success).toBe(false);
    expect(result.timings.stages.map((s) => s.stage)).toEqual(['decision', 'specialist']);
  });
});
