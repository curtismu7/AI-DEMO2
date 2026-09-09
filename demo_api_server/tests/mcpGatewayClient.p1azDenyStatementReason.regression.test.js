'use strict';
/**
 * Airlines UC6 ($2500 pay_airline_fee) through PingGateway → real PingOne
 * Authorize replied "❌ access_denied" while every Node-gateway vertical said
 * "2500 exceeds tier ceiling 2000". PingGateway's real-P1AZ DENY body
 * (p1az-decision.groovy DENY path) carries only error/decision/backend/tool —
 * no message — and P1AZ put the reason in a statement payload inside
 * X-Gw-Audit-Trail (`reason: null`). The BFF read only body.message, so the
 * surfaced reason degraded to the bare code.
 *
 * Fix is BFF-side only: when the body has no message, surface the first deny
 * statement's payload.message from the audit trail already parsed for the
 * token chain. Verdict semantics are untouched (still gateway_policy_denied,
 * backend still 'real').
 */

jest.mock('axios');
jest.mock('../services/nrSegments', () => ({
  mcpToolCall: (fn) => fn(),
  tokenExchange: (fn) => fn(),
  introspection: (fn) => fn(),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../services/mcpGatewayClient');

const TIER_MSG = "UC21 entitlement-tier capability — $2500 exceeds the 'none' tier ceiling of $2,000. PrivateBanking members have a $50,000 ceiling.";

const AUDIT_TRAIL = {
  introspection: { active: true, sub: 'u1' },
  authorize: {
    decision: 'DENY',
    backend: 'real',
    tool: 'pay_airline_fee',
    reason: null,
    rawResponse: { correlationId: 'corr-deny-1', decision: 'DENY' },
    statements: [
      {
        code: 'mcp-tier-amount-exceeded',
        name: 'MCP Denied — Tier Amount Exceeded',
        payload: { denied: true, reason: 'tier_amount_exceeded', message: TIER_MSG },
      },
      {
        code: 'mcp-authorization-denied',
        payload: { denied: true, reason: 'authorization_denied', message: 'Access denied by policy.' },
      },
    ],
  },
  filterChain: [{ filter: 'P1AZDecision', result: 'blocked', decision: 'DENY' }],
  denyingFilter: 'P1AZDecision',
};

describe('mcpGatewayClient — real-P1AZ 403 with no body message surfaces the deny statement reason', () => {
  afterEach(() => jest.clearAllMocks());

  test('message comes from the first deny statement payload; verdict fields unchanged', async () => {
    axios.post.mockResolvedValue({
      status: 403,
      headers: { 'x-gw-audit-trail': JSON.stringify(AUDIT_TRAIL) },
      data: {
        error: 'access_denied',
        decision: 'DENY',
        backend: 'real',
        tool: 'pay_airline_fee',
        mcp_method: 'tools/call',
      },
    });

    await expect(
      callToolViaGateway('https://gw.local', 'bearer-tok', 'pay_airline_fee', { amount: 2500 }, {})
    ).rejects.toMatchObject({
      code: 'gateway_policy_denied',
      httpStatus: 403,
      gatewayErrorCode: 'access_denied',
      message: TIER_MSG,
      gatewayMessage: TIER_MSG,
      gwAuditTrail: {
        authorize: { decision: 'DENY', backend: 'real', rawResponse: { correlationId: 'corr-deny-1' } },
      },
    });
  });

  test('a body message still wins over the statement payload', async () => {
    axios.post.mockResolvedValue({
      status: 403,
      headers: { 'x-gw-audit-trail': JSON.stringify(AUDIT_TRAIL) },
      data: { error: 'tier_amount_exceeded', message: '2500 exceeds tier ceiling 2000', tool: 'pay_airline_fee' },
    });

    await expect(
      callToolViaGateway('https://gw.local', 'bearer-tok', 'pay_airline_fee', { amount: 2500 }, {})
    ).rejects.toMatchObject({ gatewayErrorCode: 'tier_amount_exceeded', message: '2500 exceeds tier ceiling 2000' });
  });
});
