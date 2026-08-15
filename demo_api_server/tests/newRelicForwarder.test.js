'use strict';

jest.mock('axios');
const axios = require('axios');

const forwarder = require('../services/newRelicForwarder');

const OLD_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: {} });
  process.env.NR_LICENSE_KEY = 'test-license-key';
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

// The defect this guards: NR_LICENSE_KEY lives in demo_api_server/.env, which
// jest loads, so every `npm test` run posted fixture telemetry to the
// production New Relic account. An audit found all 50 `authorize` records in
// the account came from the fixtures `test-user-id` and `user-a-id`.
describe('newRelicForwarder test-environment guard', () => {
  it('does not POST while running under jest', async () => {
    // JEST_WORKER_ID is set by jest itself; NODE_ENV is 'test' by default.
    expect(process.env.JEST_WORKER_ID || process.env.NODE_ENV).toBeTruthy();
    await forwarder.forwardAppEvent({ category: 'authorize', message: 'x' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not POST UI events under jest either', async () => {
    await forwarder.forwardUIEvent('ui.test', { probe: 1 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not POST webhook events under jest either', async () => {
    await forwarder.forward({ eventType: 'AUTHENTICATION', status: 'SUCCESS' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('POSTs when NR_ALLOW_TEST_FORWARD overrides the guard', async () => {
    process.env.NR_ALLOW_TEST_FORWARD = 'true';
    await forwarder.forwardAppEvent({ category: 'authorize', message: 'x' });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, , config] = axios.post.mock.calls[0];
    expect(url).toContain('log-api.newrelic.com');
    expect(config.headers['Api-Key']).toBe('test-license-key');
  });

  it('still skips when the override is set but no license key exists', async () => {
    process.env.NR_ALLOW_TEST_FORWARD = 'true';
    delete process.env.NR_LICENSE_KEY;
    await forwarder.forwardAppEvent({ category: 'authorize', message: 'x' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
