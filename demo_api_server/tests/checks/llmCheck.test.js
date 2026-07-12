'use strict';
const axios = require('axios');
jest.mock('axios');
const { status } = require('../../services/checks/llmCheck');

describe('llmCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when a model is healthy', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'gpt-oss-20b', healthy: true }, { name: 'phi-4', healthy: false }] } });
    const r = await status.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.models).toHaveLength(2);
    expect(r.detail).toMatch(/1\/2/);
  });

  test('warn when proxy responds but nothing healthy', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'phi-4', healthy: false }] } });
    expect((await status.run({})).status).toBe('warn');
  });

  test('fail when proxy unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await status.run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/ECONNREFUSED/);
  });
});
