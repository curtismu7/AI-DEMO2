'use strict';

const { sendA2aProtocolHandoff } = require('../../services/a2aProtocolClient');

describe('a2aProtocolClient time bounds', () => {
  test('soft-fails a stalled bearer mint instead of hanging the A2A use case', async () => {
    const tokenEvents = [];
    const result = await sendA2aProtocolHandoff({
      vertical: 'banking',
      tokenEvents,
      timeoutMs: 5,
      deps: { oauthService: { getAiAgentClientCredentialsToken: () => new Promise(() => {}) } },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bearer mint timed out/i);
    expect(tokenEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a2a-protocol-bearer', status: 'failed' }),
    ]));
  });
});
