'use strict';
// PF's ID-JAG policy maps only the refresh token; the sims must not send the access token.

const mockPerformIdJagExchange = jest.fn();
const mockRedeemIdJag = jest.fn();

jest.mock('../../services/oauthService', () => ({
  performIdJagExchange: (...a) => mockPerformIdJagExchange(...a),
  redeemIdJag: (...a) => mockRedeemIdJag(...a),
}));
jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: jest.fn().mockResolvedValue({}),
  getMcpGatewayHttpUrl: () => 'http://mcp-gateway:3005',
}));
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: () => 'pingfederate',
  getEffective: jest.fn((k) => ({
    pf_id_jag_audience: 'http://pf-mcp-server:8080',
    pingone_resource_mcp_gateway_uri: 'https://gw.example.com',
  })[k] || null),
}));

const { runAttackSim } = require('../../services/attackSimulatorService');

const jwt = () => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u"}').toString('base64url')}.`;

beforeEach(() => {
  mockPerformIdJagExchange.mockReset().mockResolvedValue('jag');
  mockRedeemIdJag.mockReset().mockResolvedValue(jwt());
});

test('PF sim exchange sends the session refresh token with the refresh_token type', async () => {
  const req = { session: { oauthTokens: { accessToken: jwt(), refreshToken: 'rt-1' } } };
  await runAttackSim('insufficient-scope', req);
  expect(mockPerformIdJagExchange).toHaveBeenCalledWith(
    'rt-1', 'urn:ietf:params:oauth:token-type:refresh_token', expect.any(String), expect.any(String), expect.anything(),
  );
});
