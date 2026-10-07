'use strict';

/**
 * The attack simulator's direct exchange with an exchanger the identity sidecar manages
 * (ff_agent_identity_sidecar): it exchanges as that client with no local secret;
 * unmanaged with no secret keeps the plain exchange.
 */

const mockConfig = { secret: '' };
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    pingone_mcp_token_exchanger_client_id: 'exchanger-id',
    pingone_mcp_token_exchanger_client_secret: mockConfig.secret,
  })[key] || null),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));
jest.mock('../../services/oauthService', () => ({
  performTokenExchange: jest.fn().mockResolvedValue('plain-token'),
  performTokenExchangeAs: jest.fn().mockResolvedValue('exchanger-token'),
}));
const mockRelay = { manages: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const oauthService = require('../../services/oauthService');
const { _exchangeSimToken } = require('../../services/attackSimulatorService');

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.secret = '';
});

test('a managed exchanger with no local secret exchanges as that client, passing no secret', async () => {
  mockRelay.manages.mockResolvedValue(true);

  await expect(_exchangeSimToken('subject', 'aud', ['read'])).resolves.toBe('exchanger-token');

  const args = oauthService.performTokenExchangeAs.mock.calls[0];
  expect(args[2]).toBe('exchanger-id');
  expect(args[3]).toBeFalsy();
});

test('an unmanaged exchanger with no secret still takes the plain exchange', async () => {
  mockRelay.manages.mockResolvedValue(false);

  await expect(_exchangeSimToken('subject', 'aud', ['read'])).resolves.toBe('plain-token');

  expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
});

test('an exchanger with a local secret never asks the sidecar', async () => {
  mockConfig.secret = 'local-secret';

  await _exchangeSimToken('subject', 'aud', ['read']);

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  expect(mockRelay.manages).not.toHaveBeenCalled();
});
