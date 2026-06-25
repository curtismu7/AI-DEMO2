/**
 * Phase 195 — RFC 8693 Delegation Error Middleware Tests
 * T-01: Tests the REAL delegationErrorMiddleware with JWT tokens.
 *
 * Verifies:
 * - 401 for tokens missing act claim (not 403)
 * - 403 for structurally invalid act claim
 * - Pass-through for valid delegation tokens
 * - No interference when no token present
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const delegationErrorMiddleware = require('../../middleware/delegationErrorMiddleware');

// Helper: create an unsigned JWT (jwt.decode works on any well-formed JWT)
function makeToken(payload) {
  return jwt.sign(payload, 'test-secret');
}

describe('Phase 195: Real delegationErrorMiddleware (T-01)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mount the REAL middleware
    app.use('/api/mcp', delegationErrorMiddleware());

    // Protected endpoint behind the middleware
    app.get('/api/mcp/tools/list', (req, res) => {
      res.json({ tools: ['GetBalance', 'Transfer'] });
    });

    app.post('/api/mcp/tools/call', (req, res) => {
      res.json({ result: 'success', tool: req.body.tool });
    });

    // Non-MCP endpoint (middleware not mounted here)
    app.get('/api/banking/balance', (req, res) => {
      res.json({ balance: 5000 });
    });
  });

  describe('T-01a: Missing act claim → 401', () => {
    test('token without act claim returns 401 DELEGATION_CLAIM_MISSING', async () => {
      const token = makeToken({ sub: 'user-123', iss: 'https://auth.example.com' });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.error).toBe('DELEGATION_CLAIM_MISSING');
      expect(response.body.details).toBeDefined();
      expect(response.body.details.teaching).toBeTruthy();
    });

    test('status code is 401 not 403', async () => {
      const token = makeToken({ sub: 'user-456' });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe('T-01b: Structurally invalid act claim → 403', () => {
    test('act as empty object returns 403 INSUFFICIENT_PERMISSIONS', async () => {
      const token = makeToken({ sub: 'user-123', act: {} });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.details.what_failed).toContain('must be an object');
    });

    test('act with empty sub returns 403', async () => {
      const token = makeToken({ sub: 'user-123', act: { sub: '' } });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('act as string returns 403', async () => {
      const token = makeToken({ sub: 'user-123', act: 'not-an-object' });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('T-01c: Valid delegation → pass-through', () => {
    test('token with valid act.sub passes through', async () => {
      const token = makeToken({
        sub: 'user-123',
        act: { sub: 'agent-456', client_id: 'mcp-gateway' },
      });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.tools).toContain('GetBalance');
    });

    test('token with act.client_id only passes through', async () => {
      const token = makeToken({
        sub: 'user-123',
        act: { client_id: 'banking-agent' },
      });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.tools).toBeDefined();
    });

    test('nested act chain (multi-hop) passes through', async () => {
      const token = makeToken({
        sub: 'user-123',
        act: {
          sub: 'agent-1',
          act: { sub: 'orchestrator-0' },
        },
      });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.tools).toBeDefined();
    });
  });

  describe('T-01d: No token → pass-through', () => {
    test('request without Authorization header passes through', async () => {
      const response = await request(app)
        .get('/api/mcp/tools/list')
        .expect(200);

      expect(response.body.tools).toBeDefined();
    });

    test('malformed token passes through (let downstream handle)', async () => {
      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(200);

      expect(response.body.tools).toBeDefined();
    });
  });

  describe('T-01e: Non-MCP endpoints unaffected', () => {
    test('banking API works without any token', async () => {
      const response = await request(app)
        .get('/api/banking/balance')
        .expect(200);

      expect(response.body.balance).toBe(5000);
    });
  });

  describe('T-01f: Fallback removal verification', () => {
    test('subject-only token is NOT accepted (no fallback)', async () => {
      const token = makeToken({ sub: 'user-123', scope: 'read write' });

      const response = await request(app)
        .post('/api/mcp/tools/call')
        .set('Authorization', `Bearer ${token}`)
        .send({ tool: 'GetBalance' })
        .expect(401);

      expect(response.body.error).toBe('DELEGATION_CLAIM_MISSING');
    });

    test('delegated token IS accepted', async () => {
      const token = makeToken({
        sub: 'user-123',
        act: { sub: 'agent-456', client_id: 'mcp-gw' },
        scope: 'read write',
      });

      const response = await request(app)
        .post('/api/mcp/tools/call')
        .set('Authorization', `Bearer ${token}`)
        .send({ tool: 'GetBalance' })
        .expect(200);

      expect(response.body.result).toBe('success');
    });
  });

  describe('T-01g: Error response schema', () => {
    test('error includes educational fields', async () => {
      const token = makeToken({ sub: 'user-123' });

      const response = await request(app)
        .get('/api/mcp/tools/list')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('details');
      expect(response.body.details).toHaveProperty('what_failed');
      expect(response.body.details).toHaveProperty('why');
      expect(response.body.details).toHaveProperty('teaching');
      expect(response.body.details).toHaveProperty('fix');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
