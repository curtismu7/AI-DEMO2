'use strict';

/**
 * Regression: freeform "weather in <city>" must call get_weather even when
 * agent_mode is an LLM brain (Gemini/etc.) — including LLM-only and non-banking
 * verticals whose plugin tool lists omit get_weather (CivicPermit refusal).
 */

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(),
  setPipelineDeps: jest.fn(),
}));

jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async () => ({
    finalText: 'LLM should not answer weather without a tool',
    toolsCalled: [],
    iterations: 0,
  })),
  withTruncationNotice: (s) => s,
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'agent_mode') return 'gemini';
    if (key === 'agent_external_wiring') return 'bff';
    if (key === 'ff_heuristic_enabled') return 'false'; // LLM-only
    return null;
  }),
  get: jest.fn(() => null),
}));

const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const { runReasonLoop } = require('../../services/agentReasoningClient');
const configStore = require('../../services/configStore');
const { processAgentMessage } = require('../../services/demoAgentLangGraphService');

describe('UC30 weather showcase routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'agent_mode') return 'gemini';
      if (key === 'agent_external_wiring') return 'bff';
      if (key === 'ff_heuristic_enabled') return 'false';
      return null;
    });
    executeBffTool.mockResolvedValue(
      '**Location:** Dallas, Dallas County, Texas\n**Temperature:** 88°F',
    );
  });

  it('LLM-only + government vertical still dispatches get_weather for Dallas', async () => {
    const out = await processAgentMessage({
      message: "what's the weather in Dallas, TX",
      userId: 'user-1',
      userToken: 'customer.tok',
      sessionId: 's1',
      vertical: 'government',
      req: { sessionID: 's1', body: {}, session: { user: { role: 'user' } } },
    });

    expect(executeBffTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'get_weather',
        args: { city_name: 'Dallas, TX' },
      }),
    );
    expect(runReasonLoop).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
    expect(out.toolsCalled).toEqual(['get_weather']);
    expect(out.reply).toMatch(/Dallas/);
    expect(out.reply).not.toMatch(/civic.?permit|not able to pull live weather/i);
  });

  it('Gemini + Fallback ON still dispatches get_weather (toggle not ignored)', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'agent_mode') return 'gemini';
      if (key === 'agent_external_wiring') return 'bff';
      if (key === 'ff_heuristic_enabled') return 'true';
      return null;
    });

    const out = await processAgentMessage({
      message: "what's the weather in Austin, TX",
      userId: 'user-1',
      userToken: 'customer.tok',
      sessionId: 's1',
      vertical: 'banking',
      req: { sessionID: 's1', body: {}, session: { user: { role: 'user' } } },
    });

    expect(executeBffTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'get_weather' }),
    );
    expect(runReasonLoop).not.toHaveBeenCalled();
    expect(out.toolsCalled).toEqual(['get_weather']);
  });
});
