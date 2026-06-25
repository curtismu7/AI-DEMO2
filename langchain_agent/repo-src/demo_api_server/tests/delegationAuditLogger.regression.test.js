'use strict';

/**
 * Regression test for delegationAuditLogger bug fix (REGRESSION_PLAN §4 bug #2).
 *
 * Part A: telemetry/event-sink endpoints (/app-events, /mcp/tool/events,
 *         /token-chain, health) must NOT emit a delegation_action audit, while
 *         real ops (/api/mcp/tool, /api/transactions) still DO.
 * Part B: when the session token carries no `act` claim the built event must be
 *         honest: actor:null, actorSource:'session_token_no_act', _note present.
 *         When the token DOES carry act.client_id: actor set,
 *         actorSource:'act_claim', no _note.
 * Part C: buildAuditEvent must surface req.agentPath as event.agentPath.
 */

// Mock logger BEFORE requiring the module under test.
// mock-prefixed name so Jest's hoisted jest.mock factory may reference it.
const mockAuditSpy = jest.fn();
jest.mock('../utils/logger', () => ({
  logger: { audit: (...a) => mockAuditSpy(...a) },
}));
const auditSpy = mockAuditSpy;

const {
  delegationAuditMiddleware,
  extractDelegationChain,
  buildAuditEvent,
  decodeJwtClaims,
} = require('../middleware/delegationAuditLogger');

// Build a forged JWT (3 dot-parts, base64url JSON). decodeJwtClaims does no
// signature verification — only needs valid base64url JSON header+payload.
function forgeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const USER_TOKEN_NO_ACT = forgeJwt({ sub: 'user-123', email: 'u@example.com' });
const TOKEN_WITH_ACT = forgeJwt({
  sub: 'user-123',
  email: 'u@example.com',
  act: { client_id: 'agent-x' },
});

function fakeReqRes({ method, path, accessToken, agentPath }) {
  const req = {
    method,
    path,
    headers: { 'user-agent': 'jest' },
    session: { oauthTokens: { accessToken } },
  };
  if (agentPath !== undefined) req.agentPath = agentPath;
  const res = {};
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  auditSpy.mockClear();
});

describe('Part A — telemetry endpoints excluded, real ops audited', () => {
  test('POST /api/admin/app-events does NOT emit a delegation_action audit', () => {
    const { req, res, next } = fakeReqRes({
      method: 'POST',
      path: '/api/admin/app-events',
      accessToken: USER_TOKEN_NO_ACT,
    });
    delegationAuditMiddleware(req, res, next);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('GET /api/mcp/tool/events does NOT emit a delegation_action audit', () => {
    const { req, res, next } = fakeReqRes({
      method: 'GET',
      path: '/api/mcp/tool/events',
      accessToken: USER_TOKEN_NO_ACT,
    });
    delegationAuditMiddleware(req, res, next);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  test('POST /api/mcp/tool DOES emit a delegation_action audit', () => {
    const { req, res, next } = fakeReqRes({
      method: 'POST',
      path: '/api/mcp/tool',
      accessToken: USER_TOKEN_NO_ACT,
    });
    delegationAuditMiddleware(req, res, next);
    expect(auditSpy).toHaveBeenCalledWith('DELEGATION_ACTION', expect.any(Object));
  });

  test('POST /api/transactions DOES emit a delegation_action audit', () => {
    const { req, res, next } = fakeReqRes({
      method: 'POST',
      path: '/api/transactions',
      accessToken: USER_TOKEN_NO_ACT,
    });
    delegationAuditMiddleware(req, res, next);
    expect(auditSpy).toHaveBeenCalledWith('DELEGATION_ACTION', expect.any(Object));
  });
});

describe('Part B — honest actor-null reason', () => {
  test('no act claim: actor null, actorSource session_token_no_act, _note present', () => {
    const chain = extractDelegationChain(decodeJwtClaims(USER_TOKEN_NO_ACT).claims);
    expect(chain.actorSource).toBe('session_token_no_act');

    const event = buildAuditEvent(
      { method: 'POST', path: '/api/mcp/tool', headers: {} },
      chain
    );
    expect(event.actor).toBeNull();
    expect(event.actorSource).toBe('session_token_no_act');
    expect(typeof event._note).toBe('string');
    expect(event._note).toMatch(/RFC 8693 exchange/);
  });

  test('act.client_id present: actor set, actorSource act_claim, no _note', () => {
    const chain = extractDelegationChain(decodeJwtClaims(TOKEN_WITH_ACT).claims);
    expect(chain.actor).toBe('agent-x');
    expect(chain.actorSource).toBe('act_claim');

    const event = buildAuditEvent(
      { method: 'POST', path: '/api/mcp/tool', headers: {} },
      chain
    );
    expect(event.actor).toBe('agent-x');
    expect(event.actorSource).toBe('act_claim');
    expect(event._note).toBeUndefined();
  });
});

describe('Part C — agent-path attribution', () => {
  test('buildAuditEvent surfaces req.agentPath', () => {
    const chain = extractDelegationChain(decodeJwtClaims(USER_TOKEN_NO_ACT).claims);
    const event = buildAuditEvent(
      { method: 'POST', path: '/api/mcp/tool', headers: {}, agentPath: 'heuristic' },
      chain
    );
    expect(event.agentPath).toBe('heuristic');
  });

  test('agentPath falls back to x-agent-path header, else null', () => {
    const chain = extractDelegationChain(decodeJwtClaims(USER_TOKEN_NO_ACT).claims);
    const fromHeader = buildAuditEvent(
      { method: 'POST', path: '/api/mcp/tool', headers: { 'x-agent-path': 'reason_loop_3006' } },
      chain
    );
    expect(fromHeader.agentPath).toBe('reason_loop_3006');

    const none = buildAuditEvent(
      { method: 'POST', path: '/api/mcp/tool', headers: {} },
      chain
    );
    expect(none.agentPath).toBeNull();
  });
});
