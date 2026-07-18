/**
 * @file verticalManifest.checkChip.test.js
 *
 * POST /api/vertical/check-chip — docs/authorization-decision-split.md §5.5.
 *
 * Two defects pinned here:
 *   1. The call carried NO audience, so mock Rule 0b denied `invalid_aud`
 *      before Rule 1b (ChipAuthorization) could ever run — the rule was
 *      unreachable by construction.
 *   2. When the authorization server was unconfigured the route returned a
 *      local PERMIT: a fail-OPEN that is indistinguishable from a real policy
 *      permit (contract C4).
 */
'use strict';

const express = require('express');
const request = require('supertest');

// The route lazily requires both of these INSIDE the handler, and
// src/__tests__/setup.js calls jest.resetModules() after every test — so a
// factory that news up its jest.fn() would hand the handler a different
// instance than the one this file holds. Define the fns outside the factory
// (jest's `mock*` naming escape hatch) so the identity is stable.
const mockAxiosPost = jest.fn();
const mockResolveExpectedMcpResourceUri = jest.fn(() => 'https://api.ping.demo:3036/mcp');

jest.mock('axios', () => ({ post: mockAxiosPost }));
jest.mock('../../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: mockResolveExpectedMcpResourceUri,
}));

const axios = { post: mockAxiosPost };
const verticalRoutes = require('../../routes/verticalManifest');

function makeApp(user = { sub: 'u1', role: 'admin' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.session = { oauthTokens: { accessToken: null } };
    next();
  });
  app.use('/api/vertical', verticalRoutes);
  return app;
}

const ENV_KEYS = ['PINGAUTHORIZE_ENDPOINT', 'PINGAUTHORIZE_WORKER_ID', 'MCP_GW_P1AZ_ENABLED'];
let saved;

beforeEach(() => {
  jest.clearAllMocks();
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('POST /api/vertical/check-chip', () => {
  describe('when the authorization server IS configured', () => {
    beforeEach(() => {
      process.env.PINGAUTHORIZE_ENDPOINT = 'http://authz.test';
      process.env.MCP_GW_P1AZ_ENABLED = 'true';
    });

    // Without an audience, mock Rule 0b DENYs invalid_aud before Rule 1b runs.
    it('sends the expected MCP resource URI as the audience so Rule 1b is reachable', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'PERMIT', reason: 'ok' } });

      const r = await request(makeApp())
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.status).toBe(200);
      const params = axios.post.mock.calls[0][1].parameters;
      expect(params.TokenAudience).toBe('https://api.ping.demo:3036/mcp');
      expect(params.TokenAudActual).toBe('https://api.ping.demo:3036/mcp');
      // Rule 0c compares TokenAudience against McpResourceUri — both must be set
      // and equal, or the call DENYs before reaching ChipAuthorization.
      expect(params.McpResourceUri).toBe('https://api.ping.demo:3036/mcp');
      expect(params.DecisionContext).toBe('ChipAuthorization');
    });

    it('passes the policy decision through', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'DENY', reason: 'insufficient_scope: missing write' } });
      const r = await request(makeApp())
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'create_transfer' });
      expect(r.body.decision).toBe('DENY');
      expect(r.body.reason).toMatch(/insufficient_scope/);
    });
  });

  describe('when the authorization server is NOT configured', () => {
    beforeEach(() => {
      delete process.env.PINGAUTHORIZE_ENDPOINT;
      delete process.env.MCP_GW_P1AZ_ENABLED;
    });

    // C4: a gate that did not run must never be reported as a PERMIT.
    it('does not fail open with a local PERMIT', async () => {
      const r = await request(makeApp())
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.status).toBe(200);
      expect(r.body.decision).not.toBe('PERMIT');
      expect(r.body.decision).toBe('INDETERMINATE');
      expect(r.body.degraded).toBe(true);
      expect(r.body.policy_source).toBe('unconfigured');
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  it('still 400s on a missing body', async () => {
    const r = await request(makeApp()).post('/api/vertical/check-chip').send({});
    expect(r.status).toBe(400);
  });
});
