'use strict';

/**
 * mcpGatewayRateLimit.test.js — UC18 helpers for PingOne Agent Gateway (IG) path.
 */

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const configStore = require('../../services/configStore');
const {
  checkMcpGatewayRateLimit,
  shouldApplyBffRateLimit,
  shouldStampIgRateLimitHeader,
  _resetLimiterForTest,
} = require('../../services/mcpGatewayRateLimit');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function tokenWithSub(sub) {
  return `h.${b64url({ sub })}.s`;
}

describe('mcpGatewayRateLimit', () => {
  beforeEach(() => {
    _resetLimiterForTest();
    process.env.MCP_BFF_RATE_LIMIT_MAX_REQUESTS = '2';
    process.env.MCP_BFF_RATE_LIMIT_WINDOW_MS = '60000';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_mcp_rate_limit') return 'true';
      if (key === 'ff_mcp_gateway_pinggateway') return 'true';
      return null;
    });
  });

  afterEach(() => {
    delete process.env.MCP_BFF_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.MCP_BFF_RATE_LIMIT_WINDOW_MS;
  });

  it('shouldStampIgRateLimitHeader when ping gateway + flag on', () => {
    expect(shouldStampIgRateLimitHeader()).toBe(true);
  });

  it('shouldApplyBffRateLimit is always false (IG-native UC18)', () => {
    expect(shouldApplyBffRateLimit()).toBe(false);
  });

  it('checkMcpGatewayRateLimit never blocks (BFF edge disabled)', () => {
    const tok = tokenWithSub('agent-1');
    for (let i = 0; i < 5; i += 1) {
      expect(checkMcpGatewayRateLimit(tok, 'get_my_accounts').allowed).toBe(true);
    }
  });

  it('shouldStampIgRateLimitHeader false when flag off', () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_mcp_rate_limit') return 'false';
      if (key === 'ff_mcp_gateway_pinggateway') return 'true';
      return null;
    });
    expect(shouldStampIgRateLimitHeader()).toBe(false);
  });
});
