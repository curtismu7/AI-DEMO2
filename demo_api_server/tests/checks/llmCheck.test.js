'use strict';
const axios = require('axios');
jest.mock('axios');
const { status, findRequiredModel, splitExpected } = require('../../services/checks/llmCheck');

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

  // Live 2026-08-10: "2/3 model(s) loaded/healthy" on a pass card, the third
  // being tier 3 (8093) — modelCatalog marks it experimental and the default
  // stack never starts it, so 3/3 was unreachable by design. A permanent
  // phantom failure is exactly what a readiness page must not print.
  test('opt-in tiers (modelCatalog experimental) are not in the denominator', async () => {
    axios.get.mockResolvedValue({
      data: {
        models: [
          { name: 'phi-4-mini-instruct', port: 8091, healthy: true },
          { name: 'llama-3-groq-8b-tool-use', port: 8093, healthy: false },
          { name: 'gpt-oss-20b', port: 8096, healthy: true },
        ],
      },
    });
    const r = await status.run({});
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/^2\/2 model\(s\) loaded\/healthy/);
    expect(r.detail).not.toMatch(/2\/3/);
    expect(r.detail).toMatch(/llama-3-groq-8b-tool-use/);
    expect(r.meta.optInModels).toEqual(['llama-3-groq-8b-tool-use']);
    // The card still lists every tier the proxy knows.
    expect(r.meta.models).toHaveLength(3);
  });

  test('an expected tier being down is still counted against the total', async () => {
    axios.get.mockImplementation((url) => {
      if (String(url).includes(':8097')) return Promise.resolve({ data: { status: 'ok' } });
      return Promise.resolve({
        data: {
          models: [
            { name: 'phi-4-mini-instruct', port: 8091, healthy: true },
            { name: 'llama-3-groq-8b-tool-use', port: 8093, healthy: false },
            { name: 'gpt-oss-20b', port: 8096, healthy: false },
          ],
        },
      });
    });
    const r = await status.run({});
    expect(r.detail).toMatch(/^1\/2 model\(s\) loaded\/healthy/);
  });

  test('splitExpected falls back to every model when no port is recognised', () => {
    const models = [{ name: 'some-proxy-model', healthy: true }];
    expect(splitExpected(models)).toEqual({ counted: models, optIn: [] });
  });

  test('findRequiredModel matches pin name', () => {
    const models = [{ name: 'phi-4-mini-instruct', healthy: true }];
    expect(findRequiredModel(models, 'phi-4-mini-instruct')?.healthy).toBe(true);
  });
});
