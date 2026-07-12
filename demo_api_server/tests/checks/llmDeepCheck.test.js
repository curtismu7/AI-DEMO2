'use strict';
const axios = require('axios');
jest.mock('axios');
const { deep } = require('../../services/checks/llmDeepCheck');

describe('llmDeepCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when every model returns content', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'm1' }, { name: 'm2' }] } });
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'READY' } }] } });
    const r = await deep.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.models.every((m) => m.ok)).toBe(true);
  });

  test('warn when one model fails', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'm1' }, { name: 'm2' }] } });
    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'READY' } }] } })
      .mockRejectedValueOnce(new Error('load_failed'));
    const r = await deep.run({});
    expect(r.status).toBe('warn');
    expect(r.meta.models.find((m) => m.name === 'm2').ok).toBe(false);
  });

  test('fail when proxy unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await deep.run({})).status).toBe('fail');
  });
});
