// demo_api_server/tests/demoAgentLangGraphService.branchHoursVertical.regression.test.js
//
// Regression: the heuristic kind:'banking' branch hardcoded vertical:'banking'
// in executeHeuristicBanking, so the UC24 public catalog (branch_hours)
// answered with Super Banking branches in EVERY vertical — CivicPermit's
// "What city offices are near me?" chip listed bank branches. The active
// vertical must reach dispatchBankingAction for branch_hours (and only for
// branch_hours — other banking aliases stay on the shared banking rails).

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return {
    ...real,
    parseHeuristic: jest.fn(() => ({ kind: 'banking', banking: { action: 'branch_hours', params: {} } })),
  };
});

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(_cfg)) delete _cfg[k];
});

describe('processAgentMessage — branch_hours follows the active vertical (regression)', () => {
  test('government vertical returns City & County offices, never Super Banking', async () => {
    const result = await processAgentMessage({
      message: 'What city offices are near me?',
      userId: 'u1',
      userToken: undefined, // UC24 is public — no bearer required
      vertical: 'government',
      req: { body: { vertical: 'government' }, tokenEvents: [] },
    });

    expect(result.success).toBe(true);
    expect(result.toolsCalled).toContain('get_branch_hours');
    expect(result.reply).toContain('City & County office locations');
    expect(result.reply).toContain('Austin City Permits Office');
    expect(result.reply).not.toContain('Super Banking');
  });

  test('no vertical still returns Super Banking branches', async () => {
    const result = await processAgentMessage({
      message: 'What branches are near me?',
      userId: 'u1',
      userToken: undefined,
      req: { body: {}, tokenEvents: [] },
    });

    expect(result.success).toBe(true);
    expect(result.reply).toContain('Super Banking branch locations');
  });
});
