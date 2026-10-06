'use strict';

/**
 * ff_agent_identity_sidecar is read per request and reaches the agent as one
 * header. OFF (the default) must add nothing, so the agent call is byte-for-byte
 * what it was before the flag existed.
 */

const mockGetEffective = jest.fn();

jest.mock('../services/configStore', () => ({
  getEffective: mockGetEffective,
}));

const { agentIdentityHeaders } = require('../routes/agentRun').__test;

afterEach(() => mockGetEffective.mockReset());

test('flag ON adds the sidecar header', () => {
  mockGetEffective.mockImplementation((k) => (k === 'ff_agent_identity_sidecar' ? 'true' : undefined));
  expect(agentIdentityHeaders()).toEqual({ 'x-agent-identity-sidecar': '1' });
});

test.each([['false'], [undefined], [''], ['1']])('flag value %p adds no header', (value) => {
  mockGetEffective.mockReturnValue(value);
  expect(agentIdentityHeaders()).toEqual({});
});
