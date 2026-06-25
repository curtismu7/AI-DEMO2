/**
 * @file authorizeConfig.route.test.js
 * Tests for GET and POST /api/admin/authorize/config.
 *
 * Covers:
 *   GET /config
 *     - 200 with full shape (status, mcp, simulated, pingone, scopeDefinitions, flags, envVars)
 *     - workerClientId masked when set; shows "(not set)" when blank
 *     - scopeDefinitions contains all three banking scopes
 *     - 401 when authenticateToken rejects
 *     - 500 when a service throws
 *
 *   POST /config
 *     - any signed-in user may write (not admin-only)
 *     - 400 when no valid fields provided
 *     - 200 update — calls configStore.setConfig with parsed amounts
 *     - NaN amounts are ignored (not included in updates)
 *     - Negative amounts are ignored
 *     - MCP tool list strings are accepted as-is
 *     - 502 when configStore.setConfig throws
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../middleware/auth');
jest.mock('../../services/configStore');
jest.mock('../../services/transactionAuthorizationService');
jest.mock('../../services/mcpToolAuthorizationService');
jest.mock('../../services/simulatedAuthorizeService');

const { authenticateToken } = require('../../middleware/auth');
const configStore = require('../../services/configStore');
const { getAuthorizationStatusSummary } = require('../../services/transactionAuthorizationService');
const { getMcpFirstToolGateStatus } = require('../../services/mcpToolAuthorizationService');
const {
  getDenyAmountUsd,
  getStepUpAmountUsd,
  getConfirmAmountUsd,
  getConsentTypes,
  getStepUpTypes,
} = require('../../services/simulatedAuthorizeService');

const authorizeConfigRouter = require('../../routes/authorizeConfig');

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp({ user = { id: 'u1', role: 'admin' } } = {}) {
  const app = express();
  app.use(express.json());
  authenticateToken.mockImplementation((req, res, next) => {
    if (user === null) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  });
  app.use('/api/admin/authorize', authorizeConfigRouter);
  return app;
}

// ── Default mock values ───────────────────────────────────────────────────────

function setupDefaultMocks() {
  getAuthorizationStatusSummary.mockReturnValue({ activeEngine: 'simulated', allowed: true });
  getMcpFirstToolGateStatus.mockReturnValue({ enabled: true, toolGateActive: false });
  getConfirmAmountUsd.mockReturnValue(250);
  getDenyAmountUsd.mockReturnValue(2000);
  getStepUpAmountUsd.mockReturnValue(500);
  getConsentTypes.mockReturnValue(new Set(['transfer']));
  getStepUpTypes.mockReturnValue(new Set([]));
  configStore.get.mockImplementation((key) => {
    const vals = {
      SIMULATED_MCP_DENY_TOOLS: '',
      SIMULATED_MCP_HITL_TOOLS: '',
      PINGONE_AUTHORIZE_WORKER_CLIENT_ID: 'some-uuid',
      PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID: 'ep-123',
      PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID: '',
      PINGONE_AUTHORIZE_POLICY_ID: '',
      ff_authorize_simulated: 'true',
      ff_authorize_fail_open: 'false',
      ff_authorize_deposits: 'false',
      ff_authorize_mcp_first_tool: 'false',
      PINGONE_RESOURCE_MCP_SERVER_URI: 'https://mcp.example.com',
    };
    return vals[key] ?? null;
  });
  configStore.setConfig = jest.fn().mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

// ── GET /config ───────────────────────────────────────────────────────────────

describe('GET /api/admin/authorize/config', () => {
  it('returns 200 with all top-level keys', async () => {
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('mcp');
    expect(res.body).toHaveProperty('simulated');
    expect(res.body).toHaveProperty('pingone');
    expect(res.body).toHaveProperty('audience');
    expect(res.body).toHaveProperty('scopeDefinitions');
    expect(res.body).toHaveProperty('flags');
    expect(res.body).toHaveProperty('envVars');
  });

  it('simulated section includes amounts and tool arrays', async () => {
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.body.simulated.confirmAmount).toBe(250);
    expect(res.body.simulated.denyAmount).toBe(2000);
    expect(res.body.simulated.stepUpAmount).toBe(500);
    expect(Array.isArray(res.body.simulated.mcpDenyTools)).toBe(true);
    expect(Array.isArray(res.body.simulated.mcpHitlTools)).toBe(true);
  });

  it('masks workerClientId when set', async () => {
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.body.pingone.workerClientId).toBe('••••');
  });

  it('shows (not set) for workerClientId when blank', async () => {
    configStore.get.mockImplementation((key) =>
      key === 'PINGONE_AUTHORIZE_WORKER_CLIENT_ID' ? '' : null,
    );
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.body.pingone.workerClientId).toBe('(not set)');
  });

  it('scopeDefinitions contains all three banking scopes', async () => {
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.body.scopeDefinitions).toHaveProperty('read');
    expect(res.body.scopeDefinitions).toHaveProperty('write');
    expect(res.body.scopeDefinitions).toHaveProperty('mcp:invoke');
  });

  it('flags section reflects configStore boolean values', async () => {
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.body.flags.ff_authorize_simulated).toBe(true);
    expect(res.body.flags.ff_authorize_fail_open).toBe(false);
  });

  it('returns 401 when authenticateToken rejects', async () => {
    const res = await request(buildApp({ user: null })).get('/api/admin/authorize/config');
    expect(res.status).toBe(401);
  });

  it('returns 500 when a service throws', async () => {
    getAuthorizationStatusSummary.mockImplementation(() => {
      throw new Error('db exploded');
    });
    const res = await request(buildApp()).get('/api/admin/authorize/config');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});

// ── POST /config ──────────────────────────────────────────────────────────────

describe('POST /api/admin/authorize/config', () => {
  it('allows a non-admin signed-in user to write (any signed-in user, not admin-only)', async () => {
    const res = await request(buildApp({ user: { id: 'u2', role: 'user' } }))
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: 1500 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 when no valid fields are provided', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_updates');
  });

  it('returns 200 and calls setConfig with parsed amounts', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: 1500, simulated_confirm_amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(configStore.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SIMULATED_AUTHORIZE_DENY_AMOUNT: '1500',
        SIMULATED_AUTHORIZE_CONFIRM_AMOUNT: '200',
      }),
    );
  });

  it('ignores NaN amounts — does not include them in updates', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: 'not-a-number', simulated_confirm_amount: 300 });
    expect(res.status).toBe(200);
    const [updates] = configStore.setConfig.mock.calls[0];
    expect(updates).not.toHaveProperty('SIMULATED_AUTHORIZE_DENY_AMOUNT');
    expect(updates).toHaveProperty('SIMULATED_AUTHORIZE_CONFIRM_AMOUNT', '300');
  });

  it('ignores negative amounts', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: -100, simulated_stepup_amount: 500 });
    expect(res.status).toBe(200);
    const [updates] = configStore.setConfig.mock.calls[0];
    expect(updates).not.toHaveProperty('SIMULATED_AUTHORIZE_DENY_AMOUNT');
    expect(updates).toHaveProperty('SIMULATED_AUTHORIZE_STEPUP_AMOUNT', '500');
  });

  it('accepts zero as a valid amount', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_confirm_amount: 0 });
    expect(res.status).toBe(200);
    const [updates] = configStore.setConfig.mock.calls[0];
    expect(updates).toHaveProperty('SIMULATED_AUTHORIZE_CONFIRM_AMOUNT', '0');
  });

  it('accepts mcp tool list strings unchanged', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_mcp_deny_tools: 'transfer,withdraw' });
    expect(res.status).toBe(200);
    const [updates] = configStore.setConfig.mock.calls[0];
    expect(updates.SIMULATED_MCP_DENY_TOOLS).toBe('transfer,withdraw');
  });

  it('returns 200 with updated simulated section in response body', async () => {
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: 3000 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('simulated');
    expect(res.body.simulated).toHaveProperty('confirmAmount');
    expect(res.body.simulated).toHaveProperty('denyAmount');
  });

  it('returns 502 when configStore.setConfig throws', async () => {
    configStore.setConfig.mockRejectedValue(new Error('disk full'));
    const res = await request(buildApp())
      .post('/api/admin/authorize/config')
      .send({ simulated_deny_amount: 2000 });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('save_failed');
  });
});
