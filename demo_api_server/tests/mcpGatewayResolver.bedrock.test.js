'use strict';

jest.mock('../services/bedrockPathGate', () => ({
  isBedrockGatewayEffective: jest.fn(),
  assertBedrockPath: jest.fn(),
}));

const { isBedrockGatewayEffective, assertBedrockPath } = require('../services/bedrockPathGate');
const {
  resolveMcpGatewayTransport,
  callToolViaResolvedGateway,
} = require('../services/mcpGatewayTransport');
const bedrockGatewayClient = require('../services/bedrockGatewayClient');

describe('resolveMcpGatewayTransport — bedrock', () => {
  const origAc = process.env.AGENTCORE_GATEWAY_URL;
  const origGw = process.env.MCP_GATEWAY_HTTP_URL;

  afterEach(() => {
    process.env.AGENTCORE_GATEWAY_URL = origAc;
    process.env.MCP_GATEWAY_HTTP_URL = origGw;
    jest.clearAllMocks();
  });

  it('returns agentcore transport when bedrock gateway effective', () => {
    isBedrockGatewayEffective.mockReturnValue(true);
    process.env.AGENTCORE_GATEWAY_URL = 'https://agentcore.example/mcp';
    const t = resolveMcpGatewayTransport();
    expect(t.kind).toBe('agentcore');
    expect(t.url).toBe('https://agentcore.example/mcp');
  });
});

describe('callToolViaResolvedGateway — bedrock branch', () => {
  beforeEach(() => {
    jest.spyOn(bedrockGatewayClient, 'callToolViaAgentCore').mockRejectedValue(
      Object.assign(new Error('stub'), { code: 'bedrock_gateway_not_implemented', httpStatus: 503 }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('delegates to bedrockGatewayClient when effective', async () => {
    isBedrockGatewayEffective.mockReturnValue(true);
    process.env.AGENTCORE_GATEWAY_URL = 'https://agentcore.example/mcp';
    await expect(
      callToolViaResolvedGateway('https://ignored', 'tok', 'get_accounts', {}),
    ).rejects.toMatchObject({ code: 'bedrock_gateway_not_implemented' });
    expect(bedrockGatewayClient.callToolViaAgentCore).toHaveBeenCalledWith(
      'tok', 'get_accounts', {}, {},
    );
    expect(assertBedrockPath).toHaveBeenCalledWith('gateway');
  });
});
