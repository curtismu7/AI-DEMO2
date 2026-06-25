'use strict';

jest.mock('../services/mcpWebSocketClient', () => ({
  mcpCallTool: jest.fn(),
}));

jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => null),
  callToolViaGateway: jest.fn(),
}));

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../services/agentMcpTokenService', () => ({
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-123', scope: 'read' } })),
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

const { mcpCallTool: mockMcpCallTool } = require('../services/mcpWebSocketClient');
const { callMcpToolInternal } = require('../utils/mcpToolRegistry');

describe('scope abuse gate — callMcpToolInternal with freeze_account', () => {
  const READ_ONLY_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInNjb3BlIjoicmVhZCJ9.sig';
  const USER_ID = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates isError=true when MCP server rejects freeze_account for a read-only token', async () => {
    mockMcpCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: 'scope_denied', missingScopes: ['admin:write', 'users:manage'] }) }],
    });

    const result = await callMcpToolInternal(
      'freeze_account',
      { accountId: 'acct-001', freeze: true },
      READ_ONLY_TOKEN,
      USER_ID,
    );

    expect(result).toContain('scope_denied');
    expect(mockMcpCallTool).toHaveBeenCalledTimes(1);
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      'freeze_account',
      { accountId: 'acct-001', freeze: true },
      READ_ONLY_TOKEN,
      'user-123',
      expect.any(String),
    );
  });

  it('does NOT silently succeed — scope error is returned, not swallowed', async () => {
    mockMcpCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'authorization_challenge: admin:write required' }],
    });

    const result = await callMcpToolInternal(
      'freeze_account',
      { accountId: 'acct-002', freeze: true },
      READ_ONLY_TOKEN,
      USER_ID,
    );

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('calls the MCP server with the exact tool name (no aliasing or rewriting)', async () => {
    mockMcpCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'scope_denied' }],
    });

    await callMcpToolInternal('freeze_account', { accountId: 'acct-003', freeze: false }, READ_ONLY_TOKEN, USER_ID);

    const [calledToolName] = mockMcpCallTool.mock.calls[0];
    expect(calledToolName).toBe('freeze_account');
  });
});
