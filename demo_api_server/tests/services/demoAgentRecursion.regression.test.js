'use strict';

/**
 * WR-03 — bankingAgentRecursion.regression.test.js
 *
 * Mocked-dependency suite proving the agent⇄tools loop terminates at a hard
 * cap instead of running unbounded. Before WR-03 there was no recursion limit
 * / step counter — an LLM that always emits tool_calls would loop
 * tools→agent→tools until the upstream HTTP timeout (~60s).
 *
 * Phase 2 (agent consolidation): the LLM fallback no longer builds an
 * in-process LangGraph. The BFF drives the reason loop against :3006 and the
 * bound is enforced BFF-side in agentReasoningClient.runReasonLoop's
 * for(i < maxIterations) cap (still MAX_TOOL_ITERATIONS). This suite now
 * asserts the SAME WR-03 invariant through the new seam: runReasonLoop is
 * mocked, and we verify processAgentMessage RESOLVES with a clean
 * "maximum tool iteration limit" response (not a throw, not a hang).
 *
 * Test pattern follows CLAUDE.md "Test patterns: Regression vs. Integration":
 *   - configStore is mocked with TEST_CONFIG constants
 *   - agentReasoningClient.runReasonLoop is mocked so we can simulate the
 *     three terminal outcomes (max_iterations, generic failure, ok).
 */

const TEST_CONFIG = {
  ff_heuristic_enabled: 'false', // force the LLM/reasoning path
  helix_api_key: 'test-key',    // satisfy the Helix-configured check so the reason loop runs
};

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => TEST_CONFIG[key] ?? null),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
}));

// Mock the reason-loop client: the BFF-side recursion cap lives here now.
const mockRunReasonLoop = jest.fn();
jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: (...args) => mockRunReasonLoop(...args),
}));

const { MAX_TOOL_ITERATIONS } = require('../../services/agentBuilder');
const { processAgentMessage } = require('../../services/demoAgentLangGraphService');

describe('WR-03 — agent max-iterations termination (regression)', () => {
  beforeEach(() => {
    mockRunReasonLoop.mockReset();
  });

  test('a loop that always returns a tool call terminates at the cap', async () => {
    mockRunReasonLoop.mockImplementation(async (p) => {
      // MAX_TOOL_ITERATIONS is still the cap, now passed as maxIterations.
      expect(p.maxIterations).toBe(MAX_TOOL_ITERATIONS);
      return { ok: false, reason: 'max_iterations' };
    });

    const result = await processAgentMessage({
      message: 'do something that loops forever',
      userId: 'user-1',
      userToken: 'tok-1',
      sessionId: 'sess-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('max_tool_iterations');
    expect(result.reply).toMatch(/maximum tool iteration limit/i);
    expect(result.agentConfigured).toBe(true);
    expect(Array.isArray(result.tokenEvents)).toBe(true);
    expect(mockRunReasonLoop).toHaveBeenCalledTimes(1);
  });

  test('a thrown error inside the loop still propagates (not swallowed as a cap hit)', async () => {
    mockRunReasonLoop.mockImplementation(async () => {
      throw new Error('some other LLM failure');
    });

    const result = await processAgentMessage({
      message: 'normal query',
      userId: 'user-1',
      userToken: 'tok-1',
      sessionId: 'sess-1',
    });

    // processAgentMessage converts generic errors to a graceful response,
    // but it must NOT be the max-iterations one.
    expect(result.error).not.toBe('max_tool_iterations');
    expect(result.reply).not.toMatch(/maximum tool iteration limit/i);
  });

  test('happy path (final answer) returns the agent reply unchanged', async () => {
    mockRunReasonLoop.mockResolvedValue({ ok: true, answer: 'Here are your accounts.' });

    const result = await processAgentMessage({
      message: 'show my accounts',
      userId: 'user-1',
      userToken: 'tok-1',
      sessionId: 'sess-1',
    });

    expect(result.success).toBe(true);
    expect(result.reply).toBe('Here are your accounts.');
    expect(result.error).toBeUndefined();
  });
});
