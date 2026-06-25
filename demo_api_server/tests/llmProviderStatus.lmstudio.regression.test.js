// demo_api_server/tests/llmProviderStatus.lmstudio.regression.test.js
/**
 * Regression tests for anthropic-lmstudio provider status in llmProviderStatus.js.
 *
 * Mocks lmstudioService (getLmStudioBase) and global.fetch.
 */

jest.mock('../services/lmstudioService', () => ({
  getLmStudioBase: jest.fn(() => 'http://localhost:1234'),
  DEFAULT_LMSTUDIO_BASE: 'http://localhost:1234',
}));

const { getProviderStatus } = require('../services/llmProviderStatus');

function mockFetch(ok, status, body) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('getProviderStatus("anthropic-lmstudio")', () => {
  test('returns available with loaded model count when server is running and model loaded', async () => {
    mockFetch(true, 200, {
      models: [
        { key: 'google/gemma-4-e2b', loaded_instances: [{ instance_id: 'i1' }] },
      ],
    });
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.status).toBe('available');
    expect(result.hasKey).toBe(true);
    expect(result.isReachable).toBe(true);
    expect(result.reason).toMatch(/1 model/);
  });

  test('returns available with "no model loaded" reason when server running but no model loaded', async () => {
    mockFetch(true, 200, { models: [{ key: 'google/gemma-4-e2b', loaded_instances: [] }] });
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.status).toBe('available');
    expect(result.reason).toMatch(/no model loaded/i);
  });

  test('returns available with empty models array', async () => {
    mockFetch(true, 200, { models: [] });
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.status).toBe('available');
    expect(result.isReachable).toBe(true);
  });

  test('returns unreachable when LM Studio returns non-OK status', async () => {
    mockFetch(false, 503, {});
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.status).toBe('unreachable');
    expect(result.isReachable).toBe(false);
    expect(result.reason).toMatch(/503/);
  });

  test('returns unreachable when fetch throws (server not running)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.status).toBe('unreachable');
    expect(result.isReachable).toBe(false);
    expect(result.reason).toMatch(/ECONNREFUSED/);
  });

  test('hasKey is always true regardless of config (no API key required)', async () => {
    mockFetch(false, 503, {});
    const result = await getProviderStatus('anthropic-lmstudio', {});
    expect(result.hasKey).toBe(true);
  });
});
