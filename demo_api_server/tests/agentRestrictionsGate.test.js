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
  // The gate now takes both its engine choice and its failover policy from here,
  // so authorize_mode governs this gate exactly as it governs the transaction
  // and MCP-tool paths.
  resolveAuthorizeMode: jest.fn(() => ({ mode: 'simulated', useSimulated: true, failoverMode: 'deny' })),
}));

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateAgentRestrictions: jest.fn(),
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
    headers: { 'x-mcp-tool': 'create_transfer' },
    session: { user: { id: 'user-1', oauthId: 'oauth-user-1', role: 'customer' } },
    // Gate now trusts only the VERIFIED RFC 8693 `act` claim populated by
    // authenticateToken (which runs before this gate), not a raw client header.
    user: { id: 'user-1', actor: { sub: 'agent-client-id' } },
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
  simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
    mode: 'simulated', useSimulated: true, failoverMode: 'deny',
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

test('calls next() when the verified token carries no act claim (no req.user.actor)', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockImplementation((key) => key === 'ff_agent_restrictions' ? 'true' : null);
  await agentRestrictionsGate(makeReq({ user: { id: 'user-1' } }), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});

test('a forged X-Agent-Sub header with no verified act claim does NOT trigger the gate (regression: BUGS.md #2)', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockImplementation((key) => key === 'ff_agent_restrictions' ? 'true' : null);
  // Client sends the header, but authenticateToken found no `act` claim on the
  // token, so req.user.actor is absent. The header alone must never be trusted.
  await agentRestrictionsGate(
    makeReq({ headers: { 'x-agent-sub': 'forged-agent-id' }, user: { id: 'user-1' } }),
    mockRes,
    mockNext,
  );
  expect(mockNext).toHaveBeenCalled();
  expect(mockRes.status).not.toHaveBeenCalled();
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

// The gate reads its engine + failover policy from resolveAuthorizeMode, so the
// tests drive that one function rather than the flags behind it. Coverage of the
// flags-to-mode mapping itself lives in authorizeMode.resolve.test.js.
function setAuthorizeMode({ mode = 'pingone', useSimulated = false, failoverMode = 'deny' } = {}) {
  require('../services/simulatedAuthorizeService').resolveAuthorizeMode
    .mockReturnValue({ mode, useSimulated, failoverMode });
}

// P1AZ mode: real evaluator, fail closed on error.
function selectP1azMode() {
  setAuthorizeMode({ mode: 'pingone', useSimulated: false, failoverMode: 'deny' });
}

test('P1AZ mode evaluates against PingOne, not the simulated engine', async () => {
  selectP1azMode();
  const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
  pingOneAuthorizeService.evaluateAgentRestrictions.mockResolvedValue({
    decision: 'DENY', reason: 'agent_restrictions_write_blocked', decisionId: 'p1az-1',
  });
  const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');

  await agentRestrictionsGate(makeReq(), mockRes, mockNext);

  expect(pingOneAuthorizeService.evaluateAgentRestrictions).toHaveBeenCalledWith({
    subject: 'oauth-user-1',
    environment: expect.objectContaining({
      agentRestrictions: 'none',
      requiredTier: 'write',
      agentSub: 'agent-client-id',
      tool: 'create_transfer',
    }),
  });
  expect(simulatedAuthorizeService.evaluateAgentRestrictions).not.toHaveBeenCalled();
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    authorize_engine: 'pingone',
  }));
});

test('P1AZ error under failover_mode=fallback_simulated evaluates with the demo engine', async () => {
  // The one sanctioned substitution: the operator chose
  // authorize_mode='pingone_fallback_simulated', so a genuine P1AZ failure is
  // re-evaluated by the demo engine rather than 503-ing — the same policy the
  // transaction and MCP-tool paths apply. The response says which engine ruled.
  setAuthorizeMode({ mode: 'pingone_fallback_simulated', useSimulated: false, failoverMode: 'fallback_simulated' });
  const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
  pingOneAuthorizeService.evaluateAgentRestrictions.mockRejectedValue(new Error('PingOne unreachable'));
  const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');

  await agentRestrictionsGate(makeReq(), mockRes, mockNext);

  expect(simulatedAuthorizeService.evaluateAgentRestrictions).toHaveBeenCalled();
  expect(mockRes.status).toHaveBeenCalledWith(428);
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    authorize_engine: 'fallback_simulated',
  }));
});

test('P1AZ mode fails CLOSED when the evaluator throws — never substitutes the demo engine', async () => {
  // An unconfigured decision endpoint or an unreachable PingOne both arrive here
  // as a throw. The gate must 503 rather than quietly letting the in-process
  // simulated engine make a decision the operator would read as "PingOne said so".
  selectP1azMode();
  const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
  pingOneAuthorizeService.evaluateAgentRestrictions.mockRejectedValue(
    new Error('Agent restrictions decision endpoint is not configured.'),
  );
  const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');

  await agentRestrictionsGate(makeReq(), mockRes, mockNext);

  expect(mockRes.status).toHaveBeenCalledWith(503);
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'agent_restrictions_unavailable',
  }));
  expect(simulatedAuthorizeService.evaluateAgentRestrictions).not.toHaveBeenCalled();
  expect(mockNext).not.toHaveBeenCalled();
});

test('calls next() when agentRestrictions permits', async () => {
  const { isAgentRestricted } = require('../services/agentRestrictionsService');
  isAgentRestricted.mockReturnValue(false);
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});

test('fails CLOSED when restrictions are undeterminable (no worker creds) — default', async () => {
  // Real tier logic; no PingOne creds so fetchAgentRestrictions hits failover.
  const svc = require('../services/agentRestrictionsService');
  const real = jest.requireActual('../services/agentRestrictionsService');
  svc.isAgentRestricted.mockImplementation(real.isAgentRestricted);
  svc.getRequiredTier.mockReturnValue('write');
  const prevEnv = process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try {
    await agentRestrictionsGate(makeReq(), mockRes, mockNext);
    // failover value 'none' → restricted → DENY path (428), never next().
    expect(mockRes.status).toHaveBeenCalledWith(428);
    expect(mockNext).not.toHaveBeenCalled();
  } finally {
    if (prevEnv === undefined) delete process.env.PINGONE_ENVIRONMENT_ID; else process.env.PINGONE_ENVIRONMENT_ID = prevEnv;
  }
});

test('fails OPEN when failover_mode=permit and creds missing', async () => {
  const svc = require('../services/agentRestrictionsService');
  const real = jest.requireActual('../services/agentRestrictionsService');
  svc.isAgentRestricted.mockImplementation(real.isAgentRestricted);
  svc.getRequiredTier.mockReturnValue('write');
  setAuthorizeMode({ useSimulated: true, failoverMode: 'permit' });
  const prevEnv = process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try {
    await agentRestrictionsGate(makeReq(), mockRes, mockNext);
    // failover value 'write' → not restricted → next(), no 428.
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalledWith(428);
  } finally {
    if (prevEnv === undefined) delete process.env.PINGONE_ENVIRONMENT_ID; else process.env.PINGONE_ENVIRONMENT_ID = prevEnv;
  }
});

test('failover_mode=fallback_simulated keeps the gate closed when the level is undeterminable', async () => {
  // 'fallback_simulated' means "keep evaluating with the demo engine", not
  // "assume unrestricted". The restriction level is still unknown here, so the
  // gate must not hand out 'write' the way failover_mode=permit does.
  const svc = require('../services/agentRestrictionsService');
  const real = jest.requireActual('../services/agentRestrictionsService');
  svc.isAgentRestricted.mockImplementation(real.isAgentRestricted);
  svc.getRequiredTier.mockReturnValue('write');
  setAuthorizeMode({ mode: 'pingone_fallback_simulated', useSimulated: true, failoverMode: 'fallback_simulated' });
  const prevEnv = process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try {
    await agentRestrictionsGate(makeReq(), mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(428);
    expect(mockNext).not.toHaveBeenCalled();
  } finally {
    if (prevEnv === undefined) delete process.env.PINGONE_ENVIRONMENT_ID; else process.env.PINGONE_ENVIRONMENT_ID = prevEnv;
  }
});

// Regression guard: an agent-originated request with no session user AND an
// undecodable Bearer token previously hit the ONE branch in this file that
// unconditionally called next() regardless of the failover policy --
// contradicting the module's own documented fail-closed default.
test('fails CLOSED (503) when no userId is resolvable (malformed Bearer JWT, no session user) — default', async () => {
  const req = {
    headers: { authorization: 'Bearer header.not-valid-base64url-json!!!.sig' },
    session: {},
    user: { actor: { sub: 'some-agent' } },
  };
  await agentRestrictionsGate(req, mockRes, mockNext);
  expect(mockNext).not.toHaveBeenCalled();
  expect(mockRes.status).toHaveBeenCalledWith(503);
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'agent_restrictions_unavailable',
  }));
});

test('fails OPEN (next()) when no userId is resolvable and failover_mode=permit', async () => {
  setAuthorizeMode({ useSimulated: true, failoverMode: 'permit' });
  const req = {
    headers: { authorization: 'Bearer header.not-valid-base64url-json!!!.sig' },
    session: {},
    user: { actor: { sub: 'some-agent' } },
  };
  await agentRestrictionsGate(req, mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
  expect(mockRes.status).not.toHaveBeenCalled();
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
    headers: { 'authorization': `Bearer ${fakeJwt}` },
    session: {},   // no session.user
    user: { actor: { sub: 'some-agent' } },
  };
  const next = jest.fn();

  await agentRestrictionsGate(req, mockRes, next);

  expect(next).toHaveBeenCalled();
  // The gate should have fetched agentRestrictions for 'bearer-user-id' (not skipped)
  expect(attrCache.get).toHaveBeenCalledWith('bearer-user-id');
});
