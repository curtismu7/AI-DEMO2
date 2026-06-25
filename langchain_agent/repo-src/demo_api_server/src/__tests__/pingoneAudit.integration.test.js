/**
 * Integration test for PingOne Audit Endpoint
 */

const request = require('supertest');

// Mock express-session to inject session data from x-test-user header
jest.mock('express-session', () => {
  return () => (req, _res, next) => {
    req.session = req.session || {};
    req.session.save = (cb) => cb && cb();
    req.session.destroy = (cb) => cb && cb();
    const h = req.headers['x-test-user'];
    if (h) {
      try {
        req.session.user = JSON.parse(h);
        req.session.oauthTokens = { accessToken: 'mock-token' };
      } catch { /* ignore */ }
    }
    next();
  };
});

// Mock the services the route calls directly
const mockValidateResources = jest.fn();
const mockAuditResourceScopes = jest.fn();

jest.mock('../../services/resourceValidationService', () => ({
  validateResources: (...args) => mockValidateResources(...args),
}));

jest.mock('../../services/scopeAuditService', () => ({
  auditResourceScopes: (...args) => mockAuditResourceScopes(...args),
}));

const app = require('../../server');

describe('GET /api/pingone/audit', () => {
  const authenticatedUser = JSON.stringify({
    id: 'test-admin-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    const response = await request(app)
      .get('/api/pingone/audit')
      .expect(401);

    expect(response.body.error).toBe('Unauthorized - authentication required');
  });

  it('should validate resources and scopes for authenticated user', async () => {
    mockValidateResources.mockResolvedValueOnce({
      status: 'success',
      resourceValidation: [
        { resourceName: 'Super Banking AI Agent', audienceUri: 'agentgateway.ping.demo', status: 'CORRECT' },
        { resourceName: 'Super Banking MCP Server', audienceUri: 'mcpserver.ping.demo', status: 'CORRECT' },
      ],
    });
    mockAuditResourceScopes.mockResolvedValueOnce({
      status: 'success',
      scopeAudit: [
        { resourceName: 'Super Banking AI Agent', expectedScopes: ['ai:agent:read'], currentScopes: ['ai:agent:read'], status: 'OK' },
      ],
    });

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('auditedAt');
    expect(response.body).toHaveProperty('resourceValidation');
    expect(response.body).toHaveProperty('scopeAudit');
  });

  it('should return detailed resource validation results', async () => {
    mockValidateResources.mockResolvedValueOnce({
      status: 'success',
      resourceValidation: [
        { resourceName: 'Super Banking AI Agent', audienceUri: 'agentgateway.ping.demo', status: 'CORRECT' },
      ],
    });
    mockAuditResourceScopes.mockResolvedValueOnce({
      status: 'success',
      scopeAudit: [
        { resourceName: 'Super Banking AI Agent', expectedScopes: ['ai:agent:read'], currentScopes: ['ai:agent:read'], status: 'OK' },
      ],
    });

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(200);

    const resourceValidation = response.body.resourceValidation;
    expect(resourceValidation).toContainEqual(
      expect.objectContaining({
        resourceName: 'Super Banking AI Agent',
        audienceUri: 'agentgateway.ping.demo',
        status: 'CORRECT'
      })
    );
  });

  it('should include scope audit details', async () => {
    mockValidateResources.mockResolvedValueOnce({
      status: 'success',
      resourceValidation: [
        { resourceName: 'Super Banking AI Agent', audienceUri: 'agentgateway.ping.demo', status: 'CORRECT' },
      ],
    });
    mockAuditResourceScopes.mockResolvedValueOnce({
      status: 'success',
      scopeAudit: [
        { resourceName: 'Super Banking AI Agent', expectedScopes: ['ai:agent:read'], currentScopes: ['ai:agent:read'], status: 'OK' },
      ],
    });

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(200);

    const scopeAudit = response.body.scopeAudit;
    expect(scopeAudit).toHaveLength(1);
    expect(scopeAudit[0]).toHaveProperty('resourceName');
    expect(scopeAudit[0]).toHaveProperty('expectedScopes');
    expect(scopeAudit[0]).toHaveProperty('currentScopes');
    expect(scopeAudit[0]).toHaveProperty('status');
  });

  it('should return error response when resource validation fails', async () => {
    mockValidateResources.mockResolvedValueOnce({
      status: 'error',
      error: 'PingOne API error',
    });

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(200);

    expect(response.body.status).toBe('error');
    expect(response.body).toHaveProperty('error');
  });

  it('should return error when authentication token cannot be obtained', async () => {
    mockValidateResources.mockRejectedValueOnce(new Error('Failed to get management token'));

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(500);

    expect(response.body).toHaveProperty('error');
  });

  it('should include auditedAt timestamp', async () => {
    mockValidateResources.mockResolvedValueOnce({
      status: 'success',
      resourceValidation: [],
    });
    mockAuditResourceScopes.mockResolvedValueOnce({
      status: 'success',
      scopeAudit: [],
    });

    const response = await request(app)
      .get('/api/pingone/audit')
      .set('x-test-user', authenticatedUser)
      .expect(200);

    expect(response.body).toHaveProperty('auditedAt');
    expect(new Date(response.body.auditedAt)).toBeInstanceOf(Date);
  });
});
