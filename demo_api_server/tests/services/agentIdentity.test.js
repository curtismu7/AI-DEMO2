'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const configStore = require('../../services/configStore');
const { resolveAgentCredentials } = require('../../services/agentIdentity');

describe('agentIdentity', () => {
  beforeEach(() => configStore.getEffective.mockReset());

  test('resolves provisioned autonomous credentials', () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_fraud_watch_agent_client_id: 'fraud-id',
      pingone_fraud_watch_agent_client_secret: 'fraud-secret',
    }[key] || ''));
    expect(resolveAgentCredentials('Super Banking Fraud Watch Agent')).toMatchObject({
      clientId: 'fraud-id', clientSecret: 'fraud-secret', ownIdentity: true,
    });
  });

  test('fails closed when only one half of a credential pair exists', () => {
    configStore.getEffective.mockImplementation((key) => (
      key === 'pingone_fraud_watch_agent_client_id' ? 'fraud-id' : ''
    ));
    expect(resolveAgentCredentials('Super Banking Fraud Watch Agent')).toMatchObject({
      clientId: null, clientSecret: null, ownIdentity: false,
    });
  });
});
