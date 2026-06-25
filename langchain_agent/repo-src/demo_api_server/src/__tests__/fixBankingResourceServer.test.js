/**
 * @file fixBankingResourceServer.test.js
 * @description Unit tests for POST /api/pingone-test/fix-banking-resource-server
 *
 * Covers:
 *  1. Happy path — RS exists, some scopes missing → adds them
 *  2. Happy path — RS does not exist → creates RS, then adds all scopes
 *  3. All canonical scopes already present → creates 0 scopes, still succeeds
 *  4. Worker token unavailable → 503
 *  5. Resource server creation fails → 502
 *  6. Unexpected thrown error → 500
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mock dependencies BEFORE requiring the router ──────────────────────────

jest.mock('../../services/oauthService', () => ({
  getAgentClientCredentialsToken: jest.fn(),
  getMcpExchangerToken: jest.fn(),
  performTokenExchange: jest.fn(),
  performTokenExchangeAs: jest.fn(),
  performTokenExchangeFromIdToken: jest.fn(),
}));

jest.mock('../../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    getResourceServers: jest.fn(),
    getScopes: jest.fn(),
    createScopes: jest.fn(),
    createResourceServer: jest.fn(),
  },
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn().mockReturnValue(null),
}));

// Silence any remaining console noise from the route
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ─── Minimal mocks for modules that may be transitively loaded ───────────────
jest.mock('../../services/apiCallTrackerService', () => ({
  track: jest.fn(),
  getStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../services/pingOneUserService', () => ({
  getUser: jest.fn(),
  updateUser: jest.fn(),
}));

// ─── Load SUT after mocks ─────────────────────────────────────────────────────
const oauthService = require('../../services/oauthService');
const { managementService } = require('../../services/pingoneManagementService');
const configStore = require('../../services/configStore');
const pingoneTestRouter = require('../../routes/pingoneTestRoutes');

// ─── Test helpers ────────────────────────────────────────────────────────────

// Derives from the same scopeTopology the route uses — keeps tests in sync automatically.
const scopeTopology = require('../../services/scopeTopology');
const CANONICAL_SCOPES = scopeTopology.resourceScopes('Super Banking API');

/** Build a fake resource server list response with the given RS entries. */
function mockRSList(servers) {
  return { success: true, resourceServers: servers };
}

/** Build a fake scope list response with the given scope name strings. */
function mockScopeList(names) {
  return { success: true, scopes: names.map(n => ({ name: n })) };
}

/** Stub createScopes to return success for every scope supplied. */
function stubCreateScopesSuccess() {
  managementService.createScopes.mockImplementation(async (_rsId, scopeDefs) =>
    scopeDefs.map(s => ({ success: true, scope: s.name }))
  );
}

// ─── App fixture ────────────────────────────────────────────────────────────

let app;
beforeAll(() => {
  process.env.PINGONE_ENVIRONMENT_ID = 'test-env-id';
  process.env.PINGONE_REGION = 'com';
  process.env.ENDUSER_AUDIENCE = 'agentgateway.ping.demo';

  app = express();
  app.use(express.json());
  app.use('/api/pingone-test', pingoneTestRouter);
});

beforeEach(() => {
  jest.clearAllMocks();
  oauthService.getAgentClientCredentialsToken.mockResolvedValue('worker-token-abc');
  configStore.getEffective.mockReturnValue(null); // fall through to ENDUSER_AUDIENCE env var
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/pingone-test/fix-banking-resource-server', () => {

  // ── 1. RS exists, some scopes missing ──────────────────────────────────────
  describe('when RS exists and has 2 missing canonical scopes', () => {
    // Provide all canonical scopes except the last 2 as already-existing
    const presentScopes = CANONICAL_SCOPES.slice(0, -2);
    const missingScopes = CANONICAL_SCOPES.slice(-2);

    beforeEach(() => {
      managementService.getResourceServers.mockResolvedValue(
        mockRSList([{ id: 'rs-existing-id', name: 'Super Banking Resource Server', audience: 'agentgateway.ping.demo' }])
      );
      managementService.getScopes.mockResolvedValue(mockScopeList(presentScopes));
      stubCreateScopesSuccess();
    });

    it('should return 200 with success:true', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.created).toBe(false);
      expect(res.body.resourceServerId).toBe('rs-existing-id');
    });

    it('should create exactly the 2 missing scopes', async () => {
      await request(app).post('/api/pingone-test/fix-banking-resource-server');

      expect(managementService.createScopes).toHaveBeenCalledTimes(2);
      const calledWith = managementService.createScopes.mock.calls.map(c => c[1][0].name);
      expect(calledWith).toContain(missingScopes[0]);
      expect(calledWith).toContain(missingScopes[1]);
    });

    it('should include scopeResults with success:true for each', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server');

      expect(res.body.scopeResults).toHaveLength(2);
      expect(res.body.scopeResults.every(r => r.success)).toBe(true);
    });

    it('should NOT call createResourceServer', async () => {
      await request(app).post('/api/pingone-test/fix-banking-resource-server');
      expect(managementService.createResourceServer).not.toHaveBeenCalled();
    });
  });

  // ── 2. RS does not exist → create it ──────────────────────────────────────
  describe('when no banking RS exists', () => {
    beforeEach(() => {
      managementService.getResourceServers.mockResolvedValue(
        mockRSList([{ id: 'other-rs', name: 'Some Other RS', audience: 'https://other.example.com' }])
      );
      managementService.createResourceServer.mockResolvedValue({
        success: true,
        resourceServer: { id: 'new-rs-id' },
      });
      managementService.getScopes.mockResolvedValue(mockScopeList([]));
      stubCreateScopesSuccess();
    });

    it('should call createResourceServer with correct audience', async () => {
      await request(app).post('/api/pingone-test/fix-banking-resource-server');

      expect(managementService.createResourceServer).toHaveBeenCalledWith(
        expect.objectContaining({ audience: 'agentgateway.ping.demo' })
      );
    });

    it('should return created:true', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(200);

      expect(res.body.created).toBe(true);
      expect(res.body.resourceServerId).toBe('new-rs-id');
    });

    it('should create all canonical scopes', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server');

      expect(res.body.scopeResults).toHaveLength(CANONICAL_SCOPES.length);
    });
  });

  // ── 3. All canonical scopes already present ────────────────────────────────
  describe('when all canonical scopes are already present', () => {
    beforeEach(() => {
      managementService.getResourceServers.mockResolvedValue(
        mockRSList([{ id: 'rs-full', name: 'Super Banking Resource Server' }])
      );
      managementService.getScopes.mockResolvedValue(mockScopeList(CANONICAL_SCOPES));
      stubCreateScopesSuccess();
    });

    it('should return 200 with 0 scopeResults and not call createScopes', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.scopeResults).toHaveLength(0);
      expect(managementService.createScopes).not.toHaveBeenCalled();
    });
  });

  // ── 4. Worker token unavailable → 503 ──────────────────────────────────────
  describe('when worker token is unavailable', () => {
    beforeEach(() => {
      oauthService.getAgentClientCredentialsToken.mockResolvedValue(null);
    });

    it('should return 503 with descriptive error', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/worker token/i);
    });

    it('should NOT call managementService.initialize', async () => {
      await request(app).post('/api/pingone-test/fix-banking-resource-server');
      expect(managementService.initialize).not.toHaveBeenCalled();
    });
  });

  // ── 5. RS creation fails → 502 ────────────────────────────────────────────
  describe('when createResourceServer fails', () => {
    beforeEach(() => {
      managementService.getResourceServers.mockResolvedValue(mockRSList([]));
      managementService.createResourceServer.mockResolvedValue({
        success: false,
        error: 'PingOne returned 409 Conflict',
      });
    });

    it('should return 502 with the upstream error', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(502);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/PingOne returned 409/i);
    });
  });

  // ── 6. Unexpected thrown error → 500 ──────────────────────────────────────
  describe('when an unexpected error is thrown', () => {
    beforeEach(() => {
      managementService.getResourceServers.mockRejectedValue(new Error('Network timeout'));
    });

    it('should return 500 with the error message', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Operation failed. Check server logs.');
    });
  });

  // ── 7. RS found by name matching "super bank" ──────────────────────────────
  describe('when RS name contains "bank" (case-insensitive match)', () => {
    beforeEach(() => {
      managementService.getResourceServers.mockResolvedValue(
        mockRSList([{ id: 'rs-bank', name: 'Super Banking API', audience: 'https://other.example.com' }])
      );
      managementService.getScopes.mockResolvedValue(mockScopeList(CANONICAL_SCOPES));
      stubCreateScopesSuccess();
    });

    it('should find the RS without creating a new one', async () => {
      const res = await request(app)
        .post('/api/pingone-test/fix-banking-resource-server')
        .expect(200);

      expect(res.body.created).toBe(false);
      expect(res.body.resourceServerId).toBe('rs-bank');
      expect(managementService.createResourceServer).not.toHaveBeenCalled();
    });
  });
});
