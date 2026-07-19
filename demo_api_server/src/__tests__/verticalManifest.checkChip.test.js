/**
 * @file verticalManifest.checkChip.test.js
 *
 * POST /api/vertical/check-chip — docs/authorization-decision-split.md §5.5.
 *
 * Three defects pinned here:
 *   1. The call carried NO audience, so mock Rule 0b denied `invalid_aud`
 *      before Rule 1b (ChipAuthorization) could ever run — the rule was
 *      unreachable by construction.
 *   2. The FIX for (1) hardcoded TokenAudience, TokenAudActual AND
 *      McpResourceUri to the same expected URI, which is contract C1 rule 1
 *      inverted. Mock Rule 0b then passed on a fabricated value, Rule 0b-2
 *      (D-05 anti-bypass) could never flag because TokenAudActual was
 *      synthetic, and Rule 0c compared a value to itself.
 *   3. When the authorization server was unconfigured the route returned a
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

const EXPECTED_URI = 'https://api.ping.demo:3036/mcp';
// A DIFFERENT audience — the point of the C1 rule-1 pin is that the value sent
// tracks the token, not the expected resource, so these must never be equal.
const OTHER_AUD = 'https://other.example/mcp';
const FIRST_AUD = 'https://first.example/mcp';
const SECOND_AUD = 'https://second.example';

/** Minimal unsigned JWT — the route only base64url-decodes the payload. */
function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  return [header, b64(claims), 'sig'].join('.');
}

function makeApp({ user = { sub: 'u1', role: 'admin' }, accessToken = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.session = { oauthTokens: { accessToken } };
    next();
  });
  app.use('/api/vertical', verticalRoutes);
  return app;
}

const ENV_KEYS = ['PINGAUTHORIZE_ENDPOINT', 'PINGAUTHORIZE_WORKER_ID', 'MCP_GW_P1AZ_ENABLED'];
let saved;

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveExpectedMcpResourceUri.mockReturnValue(EXPECTED_URI);
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

    // C1 rule 1: "TokenAudience must never be hardcoded to the expected URI."
    // The audience sent MUST be the one on the presented token, even (especially)
    // when it differs from what the gate expects — that difference is exactly the
    // DENY that Rule 0b/0c exist to produce.
    it('sends the token ACTUAL aud, not the expected resource URI (C1 rule 1)', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'PERMIT', reason: 'ok' } });

      const r = await request(makeApp({ accessToken: jwt({ aud: OTHER_AUD, scope: 'read' }) }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.status).toBe(200);
      const params = axios.post.mock.calls[0][1].parameters;
      expect(params.TokenAudience).toBe(OTHER_AUD);
      expect(params.TokenAudActual).toBe(OTHER_AUD);
      // McpResourceUri stays the EXPECTED gateway resource (C1 defines it that
      // way) — so Rule 0c is a real comparison of two independent values.
      expect(params.McpResourceUri).toBe(EXPECTED_URI);
      expect(params.TokenAudience).not.toBe(params.McpResourceUri);
      expect(params.DecisionContext).toBe('ChipAuthorization');
    });

    it('sends the real aud when it does match the expected resource', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'PERMIT' } });

      await request(makeApp({ accessToken: jwt({ aud: EXPECTED_URI, scope: 'read write' }) }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      const params = axios.post.mock.calls[0][1].parameters;
      expect(params.TokenAudience).toBe(EXPECTED_URI);
      expect(params.TokenScopes).toBe('read write');
    });

    // C1: "TokenAudience — the actual aud of the presented token (array ⇒ first entry)"
    it('takes the first entry when aud is an array (C1)', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'PERMIT' } });

      await request(makeApp({ accessToken: jwt({ aud: [FIRST_AUD, SECOND_AUD] }) }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      const params = axios.post.mock.calls[0][1].parameters;
      expect(params.TokenAudience).toBe(FIRST_AUD);
      expect(params.TokenAudActual).toBe(FIRST_AUD);
    });

    // C1 preamble: "Absent values are omitted, never fabricated." With no token
    // there is no honest audience, so no decision can be requested. C4: say so
    // rather than posting a fabricated input and reporting the result as policy.
    it('returns INDETERMINATE without calling the PDP when the session has no token', async () => {
      const r = await request(makeApp({ accessToken: null }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.status).toBe(200);
      expect(r.body.decision).toBe('INDETERMINATE');
      expect(r.body.degraded).toBe(true);
      expect(r.body.policy_source).toBe('no-token-audience');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('returns INDETERMINATE when the token carries no aud claim', async () => {
      const r = await request(makeApp({ accessToken: jwt({ scope: 'read', sub: 'u1' }) }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.body.decision).toBe('INDETERMINATE');
      expect(r.body.policy_source).toBe('no-token-audience');
      expect(axios.post).not.toHaveBeenCalled();
    });

    // resolveExpectedMcpResourceUri() returns '' when nothing is configured
    // (REGRESSION_PLAN §3 — it no longer invents a host). With no expected
    // resource there is nothing to compare the token audience against, so the
    // badge must not claim a policy result.
    it('returns INDETERMINATE when no expected MCP resource is configured', async () => {
      mockResolveExpectedMcpResourceUri.mockReturnValue('');

      const r = await request(makeApp({ accessToken: jwt({ aud: EXPECTED_URI }) }))
        .post('/api/vertical/check-chip')
        .send({ vertical: 'banking', toolName: 'get_my_accounts' });

      expect(r.body.decision).toBe('INDETERMINATE');
      expect(r.body.policy_source).toBe('unconfigured');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('passes the policy decision through', async () => {
      axios.post.mockResolvedValue({ data: { decision: 'DENY', reason: 'insufficient_scope: missing write' } });
      const r = await request(makeApp({ accessToken: jwt({ aud: EXPECTED_URI, scope: 'read' }) }))
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
      const r = await request(makeApp({ accessToken: jwt({ aud: EXPECTED_URI }) }))
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
