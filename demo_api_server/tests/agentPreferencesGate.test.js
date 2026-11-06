'use strict';

const mockNext = jest.fn();
const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => key === 'ff_agent_preferences' ? 'true' : null),
  getEffective: jest.fn((key) => key === 'ff_agent_preferences' ? 'true' : null),
}));

jest.mock('../services/agentRestrictionsService', () => ({
  getRequiredTier: jest.fn(() => 'write'),
  isAgentRestricted: jest.fn(() => false),
}));

jest.mock('../services/simulatedAuthorizeService', () => ({
  resolveAuthorizeMode: jest.fn(() => ({ mode: 'simulated', useSimulated: true, failoverMode: 'deny' })),
  evaluateAgentRestrictions: jest.fn(),
  isSimulatedModeEnabled: jest.fn(() => true),
}));

jest.mock('../routes/mcpDecisionPolling', () => ({
  createPendingDecision: jest.fn(() => ({ taskId: 'task-prefs-1' })),
}));

jest.mock('../middleware/agentPreferencesCache', () => ({
  cache: { get: jest.fn(() => null), set: jest.fn(), invalidate: jest.fn() },
}));

let agentPreferencesGate;
let agentPreferencesService;
let configStoreMock;
let decisionPollingMock;
let prefsCacheMock;

function makeReq(overrides = {}) {
  return {
    headers: { 'x-mcp-tool': 'create_transfer' },
    body: { tool: 'create_transfer', params: {} },
    session: { user: { id: 'user-1', oauthId: 'oauth-user-1', role: 'customer' } },
    user: { id: 'user-1', actor: { sub: 'agent-client-id' } },
    ...overrides,
  };
}

function makeRes() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNext.mockReset();
  ({ agentPreferencesGate } = require('../middleware/agentPreferencesGate'));
  agentPreferencesService = require('../services/agentPreferencesService');
  configStoreMock = require('../services/configStore');
  decisionPollingMock = require('../routes/mcpDecisionPolling');
  prefsCacheMock = require('../middleware/agentPreferencesCache');
  configStoreMock.get.mockImplementation((key) => key === 'ff_agent_preferences' ? 'true' : null);
  require('../services/simulatedAuthorizeService').resolveAuthorizeMode.mockReturnValue({
    mode: 'simulated', useSimulated: true, failoverMode: 'deny',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function spyPrefs(overrides = {}) {
  const defaults = { ...agentPreferencesService.DEFAULT_PREFERENCES, allowedActions: ['read', 'write'], ...overrides };
  jest.spyOn(agentPreferencesService, 'normalizePreferences').mockReturnValue(defaults);
  jest.spyOn(agentPreferencesService, 'failoverPreferences').mockReturnValue(defaults);
  return defaults;
}

describe('agentPreferencesGate', () => {
  test('no-ops when ff_agent_preferences is off', async () => {
    configStoreMock.get.mockImplementation(() => 'false');
    const res = makeRes();
    await agentPreferencesGate(makeReq(), res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('no-ops for non-agent requests (no verified act claim)', async () => {
    const res = makeRes();
    await agentPreferencesGate(makeReq({ user: { id: 'user-1' } }), res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips (sessionless route) when no userId is resolvable', async () => {
    const res = makeRes();
    await agentPreferencesGate(makeReq({ session: {} }), res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('permits when preferences allow the tier and no agent detected', async () => {
    spyPrefs();
    const res = makeRes();
    await agentPreferencesGate(makeReq(), res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('routes to HITL (428 agent_preferences_hitl) when tier not allowed', async () => {
    spyPrefs({ allowedActions: ['read'] });
    const res = makeRes();
    await agentPreferencesGate(makeReq(), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'agent_preferences_hitl',
      taskId: 'task-prefs-1',
    }));
    expect(decisionPollingMock.createPendingDecision).toHaveBeenCalledWith(
      'oauth-user-1',
      expect.objectContaining({ tool: 'create_transfer', decisionContext: 'AgentPreferences' }),
    );
  });

  test('denies (403) when a Protect-detected agent meets unknownAgentPolicy=deny', async () => {
    spyPrefs({ unknownAgentPolicy: 'deny' });
    const req = makeReq({ session: { user: { id: 'user-1' }, protectAgentDetected: true } });
    const res = makeRes();
    await agentPreferencesGate(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'agent_preferences_denied' }));
  });

  test('routes to HITL when a Protect-detected agent meets unknownAgentPolicy=hitl (default)', async () => {
    spyPrefs();
    const req = makeReq({ session: { user: { id: 'user-1' }, protectAgentDetected: true } });
    const res = makeRes();
    await agentPreferencesGate(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'agent_preferences_hitl' }));
  });

  test('ignores the detection signal when detectAgent preference is false', async () => {
    spyPrefs({ unknownAgentPolicy: 'deny', detectAgent: false });
    const req = makeReq({ session: { user: { id: 'user-1' }, protectAgentDetected: true } });
    const res = makeRes();
    await agentPreferencesGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test('serves cached preferences without a PingOne fetch', async () => {
    prefsCacheMock.cache.get.mockReturnValue({
      ...agentPreferencesService.DEFAULT_PREFERENCES,
      allowedActions: ['read'],
    });
    const res = makeRes();
    await agentPreferencesGate(makeReq(), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(428);
  });

  test('fails closed 503 when an unexpected error occurs', async () => {
    jest.spyOn(agentPreferencesService, 'normalizePreferences').mockImplementation(() => {
      throw new Error('boom');
    });
    jest.spyOn(agentPreferencesService, 'failoverPreferences').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = makeRes();
    await agentPreferencesGate(makeReq(), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
