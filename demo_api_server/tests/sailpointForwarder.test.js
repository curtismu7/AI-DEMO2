'use strict';

jest.mock('axios');
const axios = require('axios');

const forwarder = require('../services/sailpointForwarder');

const OLD_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: {} });
  process.env.SAILPOINT_WEBHOOK_URL = 'https://example.test/sailpoint-webhook';
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

// Same defect class newRelicForwarder guards against: SAILPOINT_WEBHOOK_URL
// could live in demo_api_server/.env, which jest loads, so without this guard
// every `npm test` run would ship fixture lifecycle events to a real webhook.
describe('sailpointForwarder test-environment guard', () => {
  it('does not POST while running under jest', async () => {
    expect(process.env.JEST_WORKER_ID || process.env.NODE_ENV).toBeTruthy();
    await forwarder.forward({ eventType: 'leaver', agentId: 'glean' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('POSTs when SAILPOINT_ALLOW_TEST_FORWARD overrides the guard', async () => {
    process.env.SAILPOINT_ALLOW_TEST_FORWARD = 'true';
    await forwarder.forward({ eventType: 'leaver', agentId: 'glean', source: 'gcp' });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://example.test/sailpoint-webhook');
    expect(payload.eventType).toBe('agent_lifecycle');
    expect(payload.event.agentId).toBe('glean');
    expect(config.headers['Content-Type']).toBe('application/json');
  });

  it('still no-ops when the override is set but SAILPOINT_WEBHOOK_URL is unset', async () => {
    process.env.SAILPOINT_ALLOW_TEST_FORWARD = 'true';
    delete process.env.SAILPOINT_WEBHOOK_URL;
    await forwarder.forward({ eventType: 'leaver', agentId: 'glean' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('adds the X-Api-Key header when SAILPOINT_WEBHOOK_API_KEY is set', async () => {
    process.env.SAILPOINT_ALLOW_TEST_FORWARD = 'true';
    process.env.SAILPOINT_WEBHOOK_API_KEY = 'secret-key';
    await forwarder.forward({ eventType: 'joiner', agentId: 'chatgpt' });
    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers['X-Api-Key']).toBe('secret-key');
  });
});
