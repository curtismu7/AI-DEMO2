'use strict';
// PF + PingGateway sims must get a PingGateway-audienced token from the PF two-exchange
// (so PingGateway -> real PingOne Authorize decides), never the ID-JAG chain whose
// MCP-server-audienced token mcpGatewayClient pins to the Node gateway's mock authz.

const mockPf = {
  resolveConfig: jest.fn(),
  resolveUserSubject: jest.fn(),
  getActorToken: jest.fn(),
  performExchange: jest.fn(),
  validateIntermediateToken: jest.fn(),
  validateFinalToken: jest.fn(),
};
const mockIdJag = jest.fn();
const mockRedeem = jest.fn();
const mockProvider = { v: 'pingfederate' };

jest.mock('../../services/pfStandardTokenExchangeService', () => mockPf);
jest.mock('../../services/oauthService', () => ({
  performIdJagExchange: (...a) => mockIdJag(...a),
  redeemIdJag: (...a) => mockRedeem(...a),
  performTokenExchange: jest.fn().mockResolvedValue('p1-token'),
}));
jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: jest.fn(),
  getMcpGatewayHttpUrl: () => 'http://mcp-gateway:3005',
}));
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: () => mockProvider.v,
  getEffective: jest.fn(() => null),
}));

const { _exchangeSimToken } = require('../../services/attackSimulatorService');

const jwt = () => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.`;
const PG = 'https://api.ping.demo:3036/mcp';

beforeEach(() => {
  mockProvider.v = 'pingfederate';
  Object.values(mockPf).forEach((f) => f.mockReset());
  mockIdJag.mockReset().mockResolvedValue('jag');
  mockRedeem.mockReset().mockResolvedValue('mcpserver-aud-token');
  mockPf.resolveConfig.mockReturnValue({ agentActorScope: 'agent:invoke', intermediateAudience: 'inter', issuer: 'iss' });
  mockPf.resolveUserSubject.mockReturnValue('u1');
  mockPf.getActorToken.mockImplementation(async (_c, role) => `actor-${role}`);
  mockPf.performExchange.mockImplementation(async (_c, hop) => `tok-${hop}`);
});

test('PF + PingGateway: two-exchange to the PingGateway audience, no ID-JAG', async () => {
  const out = await _exchangeSimToken(jwt(), [PG], ['gateway:mcp:invoke'], { viaPingGateway: true });
  expect(out).toBe('tok-mcp');
  expect(mockPf.performExchange).toHaveBeenLastCalledWith(
    expect.anything(), 'mcp', 'tok-agent', 'actor-mcp', [PG], ['gateway:mcp:invoke'],
  );
  expect(mockPf.validateFinalToken).toHaveBeenCalledWith('tok-mcp', expect.objectContaining({ audience: PG, userSub: 'u1' }));
  expect(mockIdJag).not.toHaveBeenCalled();
  expect(mockRedeem).not.toHaveBeenCalled();
});

test('PF + Node gateway sims keep the ID-JAG chain (unchanged)', async () => {
  // No session refresh token in this harness: the pre-existing ID-JAG guard fires,
  // proving control reached the ID-JAG branch and not the PF two-exchange.
  await expect(_exchangeSimToken(jwt(), 'https://gw.example.com', ['read'])).rejects.toThrow(/refresh_token/);
  expect(mockPf.performExchange).not.toHaveBeenCalled();
});

test('PingOne path ignores the PF branch even with viaPingGateway', async () => {
  mockProvider.v = 'pingone';
  const out = await _exchangeSimToken(jwt(), [PG], ['gateway:mcp:invoke'], { viaPingGateway: true });
  expect(out).toBe('p1-token');
  expect(mockPf.performExchange).not.toHaveBeenCalled();
  expect(mockIdJag).not.toHaveBeenCalled();
});
