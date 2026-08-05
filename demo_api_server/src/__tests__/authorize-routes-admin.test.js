/**
 * @file authorize-routes-admin.test.js
 * Admin-only Authorize helper routes (simulated recent + evaluation status).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    try {
      req.user = JSON.parse(h);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireSession: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(),
  isReadOnly: jest.fn(() => false),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/pingOneAuthorizeService', () => ({
  isConfigured: jest.fn(() => false),
  isMcpDelegationDecisionReady: jest.fn(() => false),
  isWorkerCredentialReady: jest.fn(() => false),
  provisionDemoDecisionEndpoints: jest.fn(),
  evaluateDecisionEndpoint: jest.fn(),
  setEndpointRecording: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const { evaluateTransaction } = require('../../services/simulatedAuthorizeService');
const authorizeRouter = require('../../routes/authorize');

describe('authorize routes (admin)', () => {
  /** Builds a minimal Express app with the authorize router mounted. */
  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/authorize', authorizeRouter);
    return app;
  }

  it('GET simulated-recent-decisions returns 403 for non-admin', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/authorize/simulated-recent-decisions')
      .set('X-Test-User', JSON.stringify({ role: 'user', scopes: ['openid'], id: 'u1' }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('admin_only');
  });

  it('GET simulated-recent-decisions returns decisions for admin', async () => {
    await evaluateTransaction({ userId: 'route-test', amount: 7, type: 'transfer', acr: '' });
    const app = createApp();
    const res = await request(app)
      .get('/api/authorize/simulated-recent-decisions?limit=5')
      .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('simulated');
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(res.body.decisions.some((d) => d.parameters?.UserId === 'route-test')).toBe(true);
  });

  it('GET evaluation-status returns summary for admin', async () => {
    configStore.get.mockImplementation((k) => {
      if (k === 'authorize_enabled') return 'true';
      if (k === 'ff_authorize_real') return 'false';
      return null;
    });
    pingOneAuthorizeService.isConfigured.mockReturnValue(false);

    const app = createApp();
    const res = await request(app)
      .get('/api/authorize/evaluation-status')
      .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activeEngine: 'simulated',
      authorizeEnabledConfig: true,
      simulatedMode: true,
    });
  });

  it('GET evaluation-status returns 403 for non-admin', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/authorize/evaluation-status')
      .set('X-Test-User', JSON.stringify({ role: 'user', scopes: ['openid'] }));
    expect(res.status).toBe(403);
  });

  describe('POST bootstrap-demo-endpoints', () => {
    beforeEach(() => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(true);
      pingOneAuthorizeService.provisionDemoDecisionEndpoints.mockResolvedValue({
        transactionEndpointId: 'tx-endpoint-uuid',
        mcpEndpointId: 'mcp-endpoint-uuid',
        created: { transaction: true, mcp: true },
      });
      configStore.isReadOnly.mockReturnValue(false);
      configStore.setConfig.mockClear();
    });

    it('returns 403 for non-admin', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/bootstrap-demo-endpoints')
        .set('X-Test-User', JSON.stringify({ role: 'user', scopes: ['openid'] }))
        .send({});
      expect(res.status).toBe(403);
      expect(pingOneAuthorizeService.provisionDemoDecisionEndpoints).not.toHaveBeenCalled();
    });

    it('returns 422 when worker credentials are not configured', async () => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(false);
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/bootstrap-demo-endpoints')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('worker_not_configured');
    });

    it('provisions endpoints and saves config when writable', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/bootstrap-demo-endpoints')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({
          enableLiveAuthorize: true,
          enableMcpFirstTool: true,
          policyId: 'pol-1',
          authorizationVersionId: 'ver-1',
        });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.transactionEndpointId).toBe('tx-endpoint-uuid');
      expect(res.body.configSaved).toBe(true);
      expect(pingOneAuthorizeService.provisionDemoDecisionEndpoints).toHaveBeenCalledWith({
        policyId: 'pol-1',
        authorizationVersionId: 'ver-1',
      });
      expect(configStore.setConfig).toHaveBeenCalledWith({
        authorize_decision_endpoint_id: 'tx-endpoint-uuid',
        authorize_mcp_decision_endpoint_id: 'mcp-endpoint-uuid',
        ff_authorize_real: 'true',
        ff_authorize_mcp_first_tool: 'true',
      });
    });

    it('does not call setConfig when config store is read-only', async () => {
      configStore.isReadOnly.mockReturnValue(true);
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/bootstrap-demo-endpoints')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.configSaved).toBe(false);
      expect(res.body.copyEnvHint).toContain('PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID');
      expect(configStore.setConfig).not.toHaveBeenCalled();
    });
  });

  describe('POST evaluate-endpoint (Live Policy Console)', () => {
    beforeEach(() => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateDecisionEndpoint.mockReset();
    });

    it('allows any authenticated (non-admin) user', async () => {
      pingOneAuthorizeService.evaluateDecisionEndpoint.mockResolvedValue({
        decision: 'PERMIT', stepUpRequired: false, decisionId: 'd1', path: 'decision-endpoint', raw: {}, _debug: {},
      });
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/evaluate-endpoint')
        .set('X-Test-User', JSON.stringify({ role: 'customer', scopes: ['openid'] }))
        .send({ endpointId: 'ep-1', parameters: { Amount: 10 } });
      expect(res.status).toBe(200);
      expect(pingOneAuthorizeService.evaluateDecisionEndpoint).toHaveBeenCalledWith('ep-1', { Amount: 10 });
    });

    it('returns 400 when endpointId is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/evaluate-endpoint')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({ parameters: { Amount: 10 } });
      expect(res.status).toBe(400);
    });

    it('returns 409 when worker credentials are not configured', async () => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(false);
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/evaluate-endpoint')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({ endpointId: 'ep-1', parameters: { Amount: 10 } });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('pingone_not_configured');
    });

    it('evaluates against the supplied endpoint and normalizes the response', async () => {
      pingOneAuthorizeService.evaluateDecisionEndpoint.mockResolvedValue({
        decision: 'DENY',
        stepUpRequired: false,
        consentRequired: false,
        hitlRequired: false,
        decisionId: 'dec-123',
        path: 'decision-endpoint',
        raw: { decision: 'DENY' },
        _debug: { request: { body: { parameters: { Amount: 5000 } } }, response: { decision: 'DENY' } },
      });
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/evaluate-endpoint')
        .set('X-Test-User', JSON.stringify({ role: 'admin', scopes: ['openid'] }))
        .send({ endpointId: 'ep-1', parameters: { Amount: 5000, TransactionType: 'transfer' } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, decision: 'DENY', engine: 'pingone', endpointId: 'ep-1', decisionId: 'dec-123' });
      expect(pingOneAuthorizeService.evaluateDecisionEndpoint).toHaveBeenCalledWith('ep-1', { Amount: 5000, TransactionType: 'transfer' });
    });
  });

  describe('POST endpoints/:id/recording', () => {
    beforeEach(() => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(true);
      pingOneAuthorizeService.setEndpointRecording.mockReset();
    });

    it('returns 409 when worker credentials are not configured', async () => {
      pingOneAuthorizeService.isWorkerCredentialReady.mockReturnValue(false);
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/endpoints/ep-1/recording')
        .set('X-Test-User', JSON.stringify({ role: 'customer', scopes: ['openid'] }))
        .send({ enabled: true });
      expect(res.status).toBe(409);
      expect(pingOneAuthorizeService.setEndpointRecording).not.toHaveBeenCalled();
    });

    it('enables recording (defaults enabled=true) for any authenticated user', async () => {
      pingOneAuthorizeService.setEndpointRecording.mockResolvedValue({ id: 'ep-1', name: 'Demo', recordRecentRequests: true });
      const app = createApp();
      const res = await request(app)
        .post('/api/authorize/endpoints/ep-1/recording')
        .set('X-Test-User', JSON.stringify({ role: 'customer', scopes: ['openid'] }))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, recordRecentRequests: true });
      expect(pingOneAuthorizeService.setEndpointRecording).toHaveBeenCalledWith('ep-1', true);
    });
  });
});
