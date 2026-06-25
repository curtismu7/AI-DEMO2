'use strict';

/**
 * WR-03 — bankingAgentRecursion.integration.test.js
 *
 * Integration counterpart to bankingAgentRecursion.regression.test.js. Uses
 * the REAL configStore (reading whatever .env / runtime values exist on the
 * host) but still mocks the reason-loop client so the test can run in CI
 * without :3006 / PingOne. Forces the LLM path by passing a message
 * the heuristic parser will not match, rather than mocking ff_heuristic_enabled.
 *
 * Phase 2 (agent consolidation): the bound is enforced BFF-side in
 * agentReasoningClient.runReasonLoop's for(i < maxIterations) cap (still
 * MAX_TOOL_ITERATIONS). This confirms the recursion cap holds when wired
 * through the live configStore singleton.
 *
 * Per CLAUDE.md "Test patterns: Regression vs. Integration": the regression
 * test asserts logic in isolation against TEST_CONFIG; this confirms the
 * cap holds when wired through the live configStore singleton.
 */

// configStore is NOT mocked — it reads real .env values.

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
}));

const mockRunReasonLoop = jest.fn();
jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: (...args) => mockRunReasonLoop(...args),
}));

const { MAX_TOOL_ITERATIONS } = require('../../services/agentBuilder');
const { processAgentMessage } = require('../../services/demoAgentLangGraphService');

describe('WR-03 — agent max-iterations termination (integration, real configStore)', () => {
  // The WR-03 cap lives on the reason-loop path. Reaching it requires (a) an LLM
  // mode so the heuristic gate is OFF, and (b) Helix "configured" (helix_api_key
  // present). The default agent mode is now `heuristics` (deterministic, no LLM),
  // which would short-circuit to the catalog floor before runReasonLoop — so pin
  // an LLM mode (helix_google) via AGENT_MODE, which getEffective reads over the
  // field default. runReasonLoop is mocked, so neither value hits a real Helix.
  let _prevHelixKey, _prevAgentMode;
  beforeAll(() => {
    _prevHelixKey = process.env.HELIX_API_KEY;
    process.env.HELIX_API_KEY = _prevHelixKey || 'integration-test-helix-key';
    _prevAgentMode = process.env.AGENT_MODE;
    process.env.AGENT_MODE = 'helix_google';
  });
  afterAll(() => {
    if (_prevHelixKey === undefined) delete process.env.HELIX_API_KEY;
    else process.env.HELIX_API_KEY = _prevHelixKey;
    if (_prevAgentMode === undefined) delete process.env.AGENT_MODE;
    else process.env.AGENT_MODE = _prevAgentMode;
  });

  beforeEach(() => {
    mockRunReasonLoop.mockReset();
  });

  test('runaway tool loop terminates with the limit response via live configStore', async () => {
    mockRunReasonLoop.mockImplementation(async (p) => {
      expect(p.maxIterations).toBe(MAX_TOOL_ITERATIONS);
      return { ok: false, reason: 'max_iterations' };
    });

    // A free-form question the heuristic parser will not classify as a
    // banking action — forces the LLM/reasoning path without mocking the flag.
    const result = await processAgentMessage({
      message: 'please ponder the meaning of recursion indefinitely',
      userId: 'integration-user-1',
      userToken: 'integration-tok-1',
      sessionId: 'integration-sess-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('max_tool_iterations');
    expect(result.reply).toMatch(/maximum tool iteration limit/i);
    expect(mockRunReasonLoop).toHaveBeenCalledTimes(1);
  });
});
