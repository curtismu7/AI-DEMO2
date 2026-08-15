'use strict';

/**
 * callMcpToolInternal's catch block already translates a gateway HITL
 * obligation (error.hitl + error.rpcData) into a structured hitl_required
 * result instead of letting it fall through as a tool failure. The
 * ELICITATION obligation (error.elicitation + error.rpcData, thrown by
 * mcpGatewayClient.js on a 428 elicitation_required response) needs the
 * same non-failure treatment, with its own result shape agentTool.js can
 * distinguish from HITL/step-up.
 */

jest.mock('../services/mcpWebSocketClient', () => ({
  mcpCallTool: jest.fn(),
}));

jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://api.ping.demo:3005'),
  callToolViaGateway: jest.fn(),
}));

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../services/agentMcpTokenService', () => ({
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-123', scope: 'write' } })),
  buildTokenEvent: jest.fn((type, label, status, decoded, description, meta) => ({
    type, label, status, description, meta,
  })),
}));

jest.mock('../services/mcpToolAuditStore', () => ({
  recordToolCall: jest.fn(),
}));

jest.mock('../services/oauthService', () => ({
  performTokenExchange: jest.fn(),
}));

jest.mock('../services/braveSearchService', () => ({
  search: jest.fn(),
}));

const { callToolViaGateway: mockCallToolViaGateway } = require('../services/mcpGatewayClient');
const { callMcpToolInternal } = require('../utils/mcpToolRegistry');

describe('callMcpToolInternal — ELICITATION obligation (distinct from HITL)', () => {
  const TOKEN = 'test-agent-token-not-a-real-jwt';
  const USER_ID = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a structured elicitation_required result, not a thrown tool failure', async () => {
    mockCallToolViaGateway.mockRejectedValueOnce(Object.assign(new Error('Confirm create_withdrawal?'), {
      elicitation: true,
      rpcData: {
        elicitationId: 'elic-1',
        prompt: 'Confirm create_withdrawal?',
        toolName: 'create_withdrawal',
        expiresIn: 120,
      },
    }));

    const result = await callMcpToolInternal(
      'create_withdrawal',
      { from_account_id: 'acct-1', amount: 100 },
      TOKEN,
      USER_ID,
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('elicitation_required');
    expect(parsed.elicitationId).toBe('elic-1');
    expect(parsed.prompt).toBe('Confirm create_withdrawal?');
    expect(parsed.toolName).toBe('create_withdrawal');
    // Not the HITL shape — no challengeId/hitlChallengeId field.
    expect(parsed.hitlChallengeId).toBeUndefined();
    expect(parsed.hitl).toBeUndefined();
  });
});
