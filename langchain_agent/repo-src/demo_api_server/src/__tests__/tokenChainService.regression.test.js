/**
 * @file tokenChainService.regression.test.js
 *
 * Regression guards for the Token Chain correctness review (2026-05-16).
 * tokenChainService.js previously had ZERO behavioral coverage — it was only
 * ever jest.mock-ed away. These tests pin the fixes:
 *
 *  - H4: trackTokenEvent must fall back to additionalData.claims when no raw
 *        token is supplied (the NL/agent path passes token:'' + decoded
 *        claims). Passing token:'' must NOT wipe sub/scope/aud/expiry.
 *  - Ordering: getTokenChain must return events ASCENDING (chronological) so a
 *        panel refresh matches the forward-ordered live response.
 *  - H5: synthesizeFromSession must mark the cold-start event as unverified
 *        (verified:false, _synthetic:true) and never imply validation.
 *  - M1: getMCPToolCalls must still return BFF-local audit rows when MCP /audit
 *        fails (non-200 / network); must pass an AbortSignal on fetch.
 */

'use strict';

function makeJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('tokenChainService — Token Chain correctness regression', () => {
  let svc;

  beforeEach(() => {
    jest.resetModules();
    svc = require('../../services/tokenChainService');
    svc.clearAllTokenChains();
  });

  // ── H4: claim fallback when no raw token ────────────────────────────────────
  test('H4: trackTokenEvent uses additionalData.claims when token is empty', async () => {
    const claims = {
      sub: 'user-xyz',
      scope: 'read write',
      aud: 'mcp-server',
      exp: Math.floor(Date.now() / 1000) + 3600,
      act: { sub: 'agent-1' },
    };
    await svc.trackTokenEvent({
      eventType: 'exchange',
      token: '', // NL/agent path has no raw token
      description: 'MCP Access Token',
      userId: 'user-xyz',
      additionalData: { claims, tokenType: 'exchanged_token' },
    });

    const chain = await svc.getTokenChain('user-xyz');
    expect(chain).toHaveLength(1);
    // Previously token:'' → extractJwtClaims('') → {} wiped all of these.
    expect(chain[0].tokenSub).toBe('user-xyz');
    expect(chain[0].scopes).toEqual(['read', 'write']);
    expect(chain[0].audience).toBe('mcp-server');
    expect(chain[0].tokenType).toBe('exchanged_token');
    expect(chain[0].expiry).not.toBeNull();
  });

  test('H4: a real token still takes precedence over additionalData.claims', async () => {
    const realToken = makeJwt({ sub: 'real-sub', scope: 'openid', aud: 'banking' });
    await svc.trackTokenEvent({
      eventType: 'auth',
      token: realToken,
      description: 'User token',
      userId: 'real-sub',
      additionalData: { claims: { sub: 'WRONG', scope: 'should-not-win' } },
    });
    const chain = await svc.getTokenChain('real-sub');
    expect(chain[0].tokenSub).toBe('real-sub');
    expect(chain[0].scopes).toEqual(['openid']);
  });

  // ── Ordering: ascending / chronological ─────────────────────────────────────
  test('Ordering: getTokenChain returns events oldest-first (chronological)', async () => {
    for (const [i, label] of ['step-a', 'step-b', 'step-c'].entries()) {
      await svc.trackTokenEvent({
        eventType: 'auth',
        token: '',
        description: label,
        userId: 'u1',
        additionalData: { claims: { sub: 'u1' }, seq: i },
      });
      // Force distinct, increasing timestamps.
      await new Promise((r) => setTimeout(r, 5));
    }
    const chain = await svc.getTokenChain('u1');
    const descriptions = chain.map((e) => e.description);
    expect(descriptions).toEqual(['step-a', 'step-b', 'step-c']);
  });

  // ── H5: synthetic cold-start event must be marked unverified ────────────────
  test('H5: synthesizeFromSession marks event unverified and synthetic', () => {
    const token = makeJwt({
      sub: 'cold-start-sub',
      scope: 'openid read',
      aud: 'banking',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const [evt] = svc.synthesizeFromSession(token);
    expect(evt._synthetic).toBe(true);
    expect(evt.verified).toBe(false);
    expect(evt.status).toBe('synthesized');
    // Must NOT imply a validation happened.
    expect(evt.description.toLowerCase()).toContain('not verified');
  });

  test('H5: synthesizeFromSession returns [] for a token with no sub', () => {
    const token = makeJwt({ scope: 'openid' }); // no sub
    expect(svc.synthesizeFromSession(token)).toEqual([]);
    expect(svc.synthesizeFromSession('not-a-jwt')).toEqual([]);
    expect(svc.synthesizeFromSession(null)).toEqual([]);
  });

  // ── M1: graceful degradation of the MCP audit fetch ─────────────────────────
  test('M1: getMCPToolCalls merges BFF-local audit on non-200 and passes an AbortSignal', async () => {
    const auditStore = require('../../services/mcpToolAuditStore');
    auditStore.clearToolCalls();
    auditStore.recordToolCall({
      userId: 'any-user',
      toolName: 'show_health_record',
      success: true,
      duration: 12,
      summary: 'show_health_record completed',
    });
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push(opts);
      return { ok: false, status: 503, json: async () => ({}) };
    });
    const result = await svc.getMCPToolCalls('any-user');
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('show_health_record');
    expect(result[0].status).toBe('success');
    expect(calls[0]).toBeDefined();
    expect(calls[0].signal).toBeDefined();
    auditStore.clearToolCalls();
  });

  test('M1: getMCPToolCalls returns BFF-local rows when fetch rejects (network/timeout)', async () => {
    const auditStore = require('../../services/mcpToolAuditStore');
    auditStore.clearToolCalls();
    auditStore.recordToolCall({
      userId: 'net-user',
      toolName: 'show_mortgage',
      success: true,
      duration: 5,
    });
    global.fetch = jest.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await svc.getMCPToolCalls('net-user');
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('show_mortgage');
    auditStore.clearToolCalls();
  });

  afterEach(() => {
    delete global.fetch;
  });
});
