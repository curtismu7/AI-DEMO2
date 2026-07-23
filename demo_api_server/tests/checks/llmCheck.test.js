'use strict';
const axios = require('axios');
jest.mock('axios');
const { status, findRequiredModel } = require('../../services/checks/llmCheck');

describe('llmCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when a model is healthy and required model is healthy', async () => {
    axios.get.mockResolvedValue({
      data: {
        models: [
          { name: 'phi-4-mini-instruct', healthy: true },
          { name: 'gpt-oss-20b', healthy: false },
        ],
      },
    });
    const r = await status.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.models).toHaveLength(2);
    expect(r.detail).toMatch(/1\/2/);
  });

  test('fail when required BFF model is unhealthy (swap eviction / Docker bind)', async () => {
    axios.get.mockImplementation((url) => {
      if (String(url).includes(':8097')) return Promise.resolve({ data: { status: 'ok' } });
      return Promise.resolve({
        data: {
          models: [
            { name: 'phi-4-mini-instruct', healthy: false },
            { name: 'gpt-oss-20b', healthy: true },
          ],
        },
      });
    });
    const r = await status.run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/phi-4-mini-instruct/);
    expect(r.detail).toMatch(/LLAMA_ARG_HOST|RESIDENT|ensure 8091/i);
    expect(r.meta.tierManager).toBe('up');
  });

  test('warn when proxy responds but nothing healthy and required absent', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'other', healthy: false }] } });
    expect((await status.run({})).status).toBe('warn');
  });

  test('fail when proxy unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await status.run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/ECONNREFUSED/);
  });

  test('findRequiredModel matches pin name', () => {
    const models = [{ name: 'phi-4-mini-instruct', healthy: true }];
    expect(findRequiredModel(models, 'phi-4-mini-instruct')?.healthy).toBe(true);
  });
});
