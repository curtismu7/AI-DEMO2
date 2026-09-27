'use strict';

const mockUpsert = jest.fn();

jest.mock('../../services/lmdb/configStore.lmdb', () => ({ upsert: mockUpsert }));

const discoveryService = require('../../services/oauthDiscoveryService');

test('persists PingFederate discovery values under PF-specific keys', () => {
  discoveryService.persistDiscoveredEndpoints({
    authorization_endpoint: 'https://pf.example.test/authorize',
    token_endpoint: 'https://pf.example.test/token',
    issuer: 'https://pf.example.test',
  }, 'pingfederate');

  expect(mockUpsert.mock.calls).toEqual([
    ['pf_authorization_endpoint', 'https://pf.example.test/authorize'],
    ['pf_token_endpoint', 'https://pf.example.test/token'],
    ['pf_issuer', 'https://pf.example.test'],
  ]);
});
