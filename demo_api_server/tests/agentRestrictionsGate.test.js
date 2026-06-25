'use strict';

const mockNext = jest.fn();
const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

// These mocks must be declared at module scope (jest.mock is hoisted).
// The global afterEach in setup.js calls jest.resetModules() after each test,
// so module-level require() references go stale. We require inside each test
// (or beforeEach) to always get the current mock instance.
jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => key === 'ff_agent_restrictions' ? 'true' : null),
  getEffective: jest.fn((key) => key === 'ff_agent_restrictions' ? 'true' : null),
}));

jest.mock('../services/agentRestrictionsService', () => ({
  getRequiredTier: jest.fn(() => 'write'),
  isAgentRestricted: jest.fn(() => true),
}));

jest.mock('../services/simulatedAuthorizeService', () => ({
  evaluateAgentRestrictions: jest.fn(() => ({ decision: 'DENY', reason: 'agent_restrictions_write_blocked', path: 'simulated', decisionId: 'sim-1' })),
  isSimulatedModeEnabled: jest.fn(() => true),
}));

jest.mock('../routes/mcpDecisionPolling', () => ({
  createPendingDecision: jest.fn(() => ({ taskId: 'task-abc-123' })),
}));

jest.mock('../middleware/agentRestrictionsCache', () => ({
  cache: { get: jest.fn(() => null), set: jest.fn(), invalidate: jest.fn() },
}));

// The global setup.js afterEach calls jest.resetModules(), invalidating the module
// cache between tests. To avoid stale references in the gate's module-level imports,
// we re-require the gate (and all its dependencies) fresh each test via beforeEach.
let agentRestrictionsGate;

function makeReq(overrides = {}) {
  return {
    headers: { 'x-agent-sub': 'agent-client-id', 'x-mcp-tool': 'create_transfer' },
    session: { user: { id: 'user-1', oauthId: 'oauth-user-1', role: 'customer' } },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRes.status.mockReturnThis();
  // Re-require after resetModules so all module-level variables in the gate
  // bind to the current (fresh) mock instances.
  ({ agentRestrictionsGate } = require('../middleware/agentRestrictionsGate'));
  // Restore default mock behaviours (clearAllMocks wipes return values
  // set by mockReturnValue but preserves factory implementations — however
  // factory implementations are also recreated by resetModules, so we must
  // explicitly set them here to be safe).
  require('../services/configStore').get.mockImplementation(
    (key) => key === 'ff_agent_restrictions' ? 'true' : null
  );
  require('../services/agentRestrictionsService').isAgentRestricted.mockReturnValue(true);
  const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
  simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
  simulatedAuthorizeService.evaluateAgentRestrictions.mockReturnValue({
    decision: 'DENY', reason: 'agent_restrictions_write_blocked', path: 'simulated', decisionId: 'sim-1',
  });
  require('../routes/mcpDecisionPolling').createPendingDecision.mockReturnValue({ taskId: 'task-abc-123' });
  require('../middleware/agentRestrictionsCache').cache.get.mockReturnValue(null);
});

test('calls next() immediately when ff_agent_restrictions is false', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockImplementation((key) => key === 'ff_agent_restrictions' ? 'false' : null);
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
  expect(mockRes.status).not.toHaveBeenCalled();
});

test('calls next() when X-Agent-Sub header is absent', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockImplementation((key) => key === 'ff_agent_restrictions' ? 'true' : null);
  await agentRestrictionsGate(makeReq({ headers: {} }), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});

test('returns 428 with taskId on DENY', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockImplementation((key) => key === 'ff_agent_restrictions' ? 'true' : null);
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockRes.status).toHaveBeenCalledWith(428);
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'agent_restrictions_hitl',
    taskId: 'task-abc-123',
  }));
  expect(mockNext).not.toHaveBeenCalled();
});

test('calls next() when agentRestrictions permits', async () => {
  const { isAgentRestricted } = require('../services/agentRestrictionsService');
  isAgentRestricted.mockReturnValue(false);
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});

test('resolves userId from Bearer JWT when session has no user', async () => {
  // A minimal JWT payload: base64url-encode { sub: 'bearer-user-id' }
  const payload = Buffer.from(JSON.stringify({ sub: 'bearer-user-id' })).toString('base64url');
  const fakeJwt = `header.${payload}.sig`;

  require('../services/configStore').get.mockImplementation(
    (key) => key === 'ff_agent_restrictions' ? 'true' : null
  );
  const { isAgentRestricted } = require('../services/agentRestrictionsService');
  isAgentRestricted.mockReturnValue(false);
  const attrCache = require('../middleware/agentRestrictionsCache').cache;
  attrCache.get.mockReturnValue('write');

  const req = {
    headers: { 'x-agent-sub': 'some-agent', 'authorization': `Bearer ${fakeJwt}` },
    session: {},   // no session.user
  };
  const next = jest.fn();

  await agentRestrictionsGate(req, mockRes, next);

  expect(next).toHaveBeenCalled();
  // The gate should have fetched agentRestrictions for 'bearer-user-id' (not skipped)
  expect(attrCache.get).toHaveBeenCalledWith('bearer-user-id');
});
