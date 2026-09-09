'use strict';

/**
 * Regression (2026-09-08): RFC 8707 audience narrowing in
 * resolveMcpAccessTokenWithEvents must FAIL LOUD when it drops a scope the tool
 * requires. configStore.validateScopeAudience silently narrows (`narrowed: true`,
 * no error) whenever the audience allow-list in buildAllowedScopesByAudience
 * lacks a scope. When that scope is one the tool's requiredScopes needs (the
 * `transfer` drift that broke UC6/7/8/22), the exchanged token is minted short
 * and the gateway 403s `insufficient_scope: missing transfer` — a misleading
 * failure that points at PingOne/the gateway instead of the BFF allow-list.
 *
 * The BFF must instead log at error level (tool, audience, dropped scopes) and
 * throw an explicit BFF-misconfiguration error before any exchange runs.
 */

const _cfg = { pingone_resource_mcp_server_uri: 'mcpserver.ping.demo' };
const mockValidateScopeAudience = jest.fn();
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
  validateScopeAudience: (...args) => mockValidateScopeAudience(...args),
}));

// JWKS unreachable → the resolver records "skipped" and proceeds (existing behavior).
jest.mock('../services/tokenValidationService', () => ({
  validateToken: jest.fn(async () => { throw new Error('jwks unreachable (test)'); }),
}));

const { logger } = require('../utils/logger');
const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');

function unsignedJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function makeReq() {
  return {
    sessionID: 'sess-1',
    session: {
      oauthTokens: {
        accessToken: unsignedJwt({
          sub: 'user-1',
          scope: 'read write transfer',
          aud: 'enduser.ping.demo',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
      save: (cb) => cb && cb(),
    },
  };
}

describe('audience narrowing that drops a required tool scope', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    // Simulate the allow-list drift: `transfer` is not on the MCP Server
    // audience list, so validateScopeAudience narrows [write, transfer] → [write].
    mockValidateScopeAudience.mockImplementation((scopes) => ({
      valid: true,
      scopes: scopes.filter((s) => s !== 'transfer'),
      narrowed: scopes.includes('transfer'),
    }));
  });
  afterEach(() => {
    errorSpy.mockRestore();
    mockValidateScopeAudience.mockReset();
  });

  test('create_transfer: throws an explicit BFF misconfiguration error instead of minting a short token', async () => {
    let caught;
    try {
      await resolveMcpAccessTokenWithEvents(makeReq(), 'create_transfer');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('bff_scope_audience_misconfigured');
    expect(caught.httpStatus).toBe(500);
    expect(caught.message).toMatch(/create_transfer/);
    expect(caught.message).toMatch(/mcpserver\.ping\.demo/);
    expect(caught.message).toMatch(/transfer/);
    expect(Array.isArray(caught.tokenEvents)).toBe(true);
  });

  test('logs at error level with tool, audience and the dropped scopes', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(), 'create_transfer').catch(() => {});
    const line = errorSpy.mock.calls.map((c) => c.slice(1).join(' ')).find((m) => /create_transfer/.test(m));
    expect(line).toBeDefined();
    expect(line).toMatch(/mcpserver\.ping\.demo/);
    expect(line).toMatch(/\btransfer\b/);
  });
});
