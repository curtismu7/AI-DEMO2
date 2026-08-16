'use strict';
/**
 * #68 — a 403 hitl_required response must carry the gateway audit trail.
 *
 * The 403 HITL branch threw WITHOUT gwAuditTrail, unlike every sibling
 * obligation branch (428 hitl/step-up/elicitation, generic 403 deny). The
 * pipeline's hitl_required handler reads err.gwAuditTrail to build the
 * gw-authorize Token Chain card; without it the P1AZ PERMIT-before-obligation
 * decision is lost and ProofStrip renders "Run failed before authorize-decision"
 * on a gate that actually fired.
 */

jest.mock('axios');
jest.mock('../services/nrSegments', () => ({
  mcpToolCall: (fn) => fn(),
  tokenExchange: (fn) => fn(),
  introspection: (fn) => fn(),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../services/mcpGatewayClient');

const AUDIT_TRAIL = {
  introspection: { active: true, sub: 'u1' },
  authorize: {
    decision: 'PERMIT',
    backend: 'real',
    rawResponse: { correlationId: 'corr-hitl-1', decision: 'PERMIT' },
  },
  filterChain: [{ filter: 'P1AZDecision', result: 'indeterminate' }],
};

describe('mcpGatewayClient — #68 403 hitl_required carries gwAuditTrail', () => {
  afterEach(() => jest.clearAllMocks());

  test('403 hitl body: thrown error includes gwAuditTrail parsed from X-Gw-Audit-Trail', async () => {
    axios.post.mockResolvedValue({
      status: 403,
      headers: { 'x-gw-audit-trail': JSON.stringify(AUDIT_TRAIL) },
      data: {
        error: 'hitl_required',
        hitl: true,
        tool: 'transfer_funds',
        challengeId: 'chal-1',
        challenge_type: 'consent',
        message: 'Human approval required',
      },
    });

    await expect(
      callToolViaGateway('https://gw.local', 'bearer-tok', 'transfer_funds', { amount: 2500 }, {})
    ).rejects.toMatchObject({
      httpStatus: 403,
      gatewayErrorCode: 'hitl_required',
      hitl: true,
      gwAuditTrail: {
        authorize: { decision: 'PERMIT', rawResponse: { correlationId: 'corr-hitl-1' } },
      },
    });
  });
});
