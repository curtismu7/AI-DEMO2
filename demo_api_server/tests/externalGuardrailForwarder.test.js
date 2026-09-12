'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
}));
const configStore = require('../services/configStore');

const forwarder = require('../services/externalGuardrailForwarder');

const OLD_ENV = { ...process.env };

function stubStore({ flag = 'false', url = '' } = {}) {
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'ff_external_guardrail_webhook') return flag;
    if (key === 'EXTERNAL_GUARDRAIL_WEBHOOK_URL') return url;
    return '';
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

// Same defect class sailpointForwarder/newRelicForwarder guard against: a real
// forward call must never fire during `npm test`, regardless of what the flag
// and URL are configured to.
describe('externalGuardrailForwarder test-environment guard', () => {
  it('does not POST while running under jest, even when the flag and URL are set', async () => {
    stubStore({ flag: 'true', url: 'https://example.test/guardrail-webhook' });
    expect(process.env.JEST_WORKER_ID || process.env.NODE_ENV).toBeTruthy();
    await forwarder.forwardDenial({ provider: 'anthropic', prompt: 'hi', verdict: 'BLOCKED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('POSTs when EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD overrides the guard', async () => {
    process.env.EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD = 'true';
    stubStore({ flag: 'true', url: 'https://example.test/guardrail-webhook' });
    await forwarder.forwardDenial({
      provider: 'anthropic',
      prompt: 'transfer my life savings',
      route: 'privilege_claude',
      code: 'llm_policy_denied',
      verdict: 'BLOCKED',
      reason: 'content policy',
      latencyMs: 42,
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://example.test/guardrail-webhook');
    expect(payload.source).toBe('ai-demo-bff');
    expect(payload.eventType).toBe('ai_guard_denial');
    expect(payload.provider).toBe('anthropic');
    expect(payload.prompt).toBe('transfer my life savings');
    expect(payload.reason).toBe('content policy');
    expect(config.headers['Content-Type']).toBe('application/json');
  });

  it('no-ops when the flag is OFF, even with the override and a URL set', async () => {
    process.env.EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD = 'true';
    stubStore({ flag: 'false', url: 'https://example.test/guardrail-webhook' });
    await forwarder.forwardDenial({ provider: 'anthropic', prompt: 'hi', verdict: 'BLOCKED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('no-ops when the flag is ON but no URL is configured', async () => {
    process.env.EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD = 'true';
    stubStore({ flag: 'true', url: '' });
    await forwarder.forwardDenial({ provider: 'anthropic', prompt: 'hi', verdict: 'BLOCKED' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
