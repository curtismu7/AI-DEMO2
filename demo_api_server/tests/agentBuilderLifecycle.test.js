'use strict';

/**
 * Agent Builder writes lifecycle history keyed by PingOne APPLICATION ID.
 *
 * Half B of the lifecycle-join fix. The registry's PingOne rows are keyed by
 * app UUID, but nothing ever emitted an event under that key — every emitter
 * (killSwitchService, controlPlane) writes runtime agent handles instead. So
 * the Lifecycle tab was structurally empty for all 13 PingOne agents.
 *
 * Creating and deleting an agent are the two real joiner/leaver moments this
 * service owns, so they are where the history starts.
 */

jest.mock('axios');
jest.mock('../services/agentLifecycleEvents', () => ({ emit: jest.fn(), query: jest.fn() }));
// Stand in for the worker-credential round-trip; this suite is about which key
// the event carries, not about reaching PingOne.
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-token'),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => (k === 'PINGONE_ENVIRONMENT_ID' ? 'env-1' : 'com')),
}));

const axios = require('axios');
const agentLifecycleEvents = require('../services/agentLifecycleEvents');
const agentBuilderService = require('../services/agentBuilderService');

const USER = { id: 'user-1', username: 'demo@example.com' };

beforeEach(() => {
  jest.clearAllMocks();
  // No pre-existing agent, so createAgentForUser takes the create path.
  axios.get = jest.fn().mockResolvedValue({ data: { _embedded: { applications: [] } } });
});

describe('agentBuilderService lifecycle events', () => {
  test('emits a joiner keyed by the PingOne application id on create', async () => {
    axios.post = jest.fn().mockResolvedValue({
      data: { id: 'app-uuid-9', name: 'AI Agent - demo', enabled: true, type: 'AI_AGENT' },
    });

    await agentBuilderService.createAgentForUser(USER);

    expect(agentLifecycleEvents.emit).toHaveBeenCalledTimes(1);
    const ev = agentLifecycleEvents.emit.mock.calls[0][0];
    expect(ev.eventType).toBe('joiner');
    // The key is the whole point — a runtime handle here reintroduces the bug.
    expect(ev.agentId).toBe('app-uuid-9');
    expect(ev.kind).toBe('live');
  });

  test('does not emit when the agent already existed — that is not a joiner', async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { _embedded: { applications: [
        { id: 'app-uuid-9', name: 'AI Agent - demo@example.com', description: 'Created by Agent Builder for user-1', enabled: true },
      ] } },
    });

    await agentBuilderService.createAgentForUser(USER);

    expect(agentLifecycleEvents.emit).not.toHaveBeenCalled();
  });

  test('emits a leaver keyed by the same id on delete', async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { _embedded: { applications: [
        { id: 'app-uuid-9', name: 'AI Agent - demo@example.com', description: 'Created by Agent Builder for user-1', enabled: true },
      ] } },
    });
    axios.delete = jest.fn().mockResolvedValue({ data: {} });

    await agentBuilderService.deleteAgentForUser(USER);

    const ev = agentLifecycleEvents.emit.mock.calls[0][0];
    expect(ev.eventType).toBe('leaver');
    expect(ev.agentId).toBe('app-uuid-9');
  });

  test('a failed emit never fails the create — history is not worth losing an agent over', async () => {
    axios.post = jest.fn().mockResolvedValue({
      data: { id: 'app-uuid-9', name: 'AI Agent - demo', enabled: true },
    });
    agentLifecycleEvents.emit.mockImplementation(() => { throw new Error('lmdb down'); });

    await expect(agentBuilderService.createAgentForUser(USER)).resolves.toMatchObject({ created: true });
  });
});
