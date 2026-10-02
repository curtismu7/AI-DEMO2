'use strict';

// The BFF -> agent-service /reason hop must present the SAME secret every other
// internal hop presents (utils/internalSecret.js, which reads process.env — the
// value the vault loader exports). It used to read configStore first, so the
// three hops could disagree and /reason answered 403 while /run worked.
const axios = require('axios');
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => 'value-from-configStore') }));

const { runReasonLoop } = require('../services/agentReasoningClient');
const { internalSecret } = require('../utils/internalSecret');

const run = () => runReasonLoop({
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  anthropicApiKey: 'sk-test',
  maxIterations: 3,
  executeTool: jest.fn(),
});

describe('runReasonLoop — which internal secret it presents', () => {
  const saved = process.env.BFF_INTERNAL_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.BFF_INTERNAL_SECRET;
    else process.env.BFF_INTERNAL_SECRET = saved;
    axios.post.mockReset();
  });

  test('sends the shared resolver value, not a configStore one', async () => {
    process.env.BFF_INTERNAL_SECRET = 'value-from-env';
    axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: 'ok' } });
    await run();
    const [, , options] = axios.post.mock.calls[0];
    expect(options.headers['x-internal-gateway-secret']).toBe('value-from-env');
    expect(options.headers['x-internal-gateway-secret']).toBe(internalSecret());
  });

  test('reads it per call, so a value the vault loader sets later is used', async () => {
    process.env.BFF_INTERNAL_SECRET = 'first';
    axios.post.mockResolvedValue({ data: { type: 'final', answer: 'ok' } });
    await run();
    process.env.BFF_INTERNAL_SECRET = 'second';
    await run();
    expect(axios.post.mock.calls[1][2].headers['x-internal-gateway-secret']).toBe('second');
  });
});
