'use strict';

jest.mock('../services/spiffeWorkloadClient', () => ({
  getSigningKeyPem: jest.fn(() => 'SPIFFE_KEY'),
  getKid: jest.fn(() => 'spiffe-kid'),
}));

const configStore = require('../services/configStore');
const workload = require('../services/spiffeWorkloadClient');
const service = require('../services/clientAssertionService');

describe('clientAssertionService SPIFFE key source', () => {
  afterEach(() => jest.restoreAllMocks());

  test('uses SPIFFE key material only when the SPIFFE flag is enabled', () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => (
      key === 'ff_spiffe_client_auth' ? 'true' : ''
    ));
    jest.spyOn(require('jsonwebtoken'), 'sign').mockReturnValue('assertion');

    expect(service.buildClientAssertion('client', 'https://auth.example/token')).toBe('assertion');
    expect(workload.getSigningKeyPem).toHaveBeenCalled();
    expect(workload.getKid).toHaveBeenCalled();
  });
});
