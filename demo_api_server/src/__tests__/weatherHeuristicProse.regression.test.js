'use strict';

/**
 * Regression: UC30 weather-mcp returns markdown prose via executeBffTool's
 * unwrapped content[0].text. Forcing parseToolResult treated success as
 * tool_result_unparseable → chat "couldn't be completed" + Incomplete strip.
 */
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(),
  setPipelineDeps: jest.fn(),
}));

const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const { dispatchBankingAction } = require('../../services/demoAgentLangGraphService');

describe('UC30 weather heuristic accepts prose tool results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success with markdown weather text (not unparseable error)', async () => {
    const prose =
      '**Location:** Austin, Travis County, Texas, United States (30.2711, -97.7437)\n' +
      '# Current Weather Conditions\n**Temperature:** 95°F';
    executeBffTool.mockResolvedValue(prose);

    const out = await dispatchBankingAction(
      'weather',
      { city_name: 'Austin, TX' },
      'user-1',
      { userToken: 'tok', req: { sessionID: 's1' }, isAdmin: false },
    );

    expect(executeBffTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'get_weather',
        args: { city_name: 'Austin, TX' },
      }),
    );
    expect(out.success).toBe(true);
    expect(out.toolsCalled).toEqual(['get_weather']);
    expect(out.reply).toBe(prose);
    expect(out.reply).not.toMatch(/tool_result_unparseable|Could not get the weather/);
  });

  it('surfaces gateway deny JSON as failure', async () => {
    executeBffTool.mockResolvedValue(
      JSON.stringify({
        error: 'Agent Gateway: weather scope restricted to Texas (demo policy)',
      }),
    );

    const out = await dispatchBankingAction(
      'weather',
      { city_name: 'Miami' },
      'user-1',
      { userToken: 'tok', req: { sessionID: 's1' }, isAdmin: false },
    );

    expect(out.success).toBe(false);
    expect(out.reply).toMatch(/weather scope restricted to Texas/);
  });
});
