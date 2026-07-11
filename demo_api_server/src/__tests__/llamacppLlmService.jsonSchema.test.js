'use strict';

describe('callLlamaCpp json schema constraint', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    process.env.LLAMACPP_MODEL = 'test-model'; // skip the /v1/models discovery fetch
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LLAMACPP_MODEL;
  });

  const okResponse = (content) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('sends response_format with the schema when opts.jsonSchema is set', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return okResponse('{"kind":"none"}'); });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    const schema = { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } };
    await callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: schema });
    expect(calls[0].response_format).toEqual({ type: 'json_object', schema });
  });

  it('omits response_format without opts (conversational path unchanged)', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return okResponse('hello'); });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await callLlamaCpp([{ role: 'user', content: 'hi' }]);
    expect(calls[0].response_format).toBeUndefined();
  });

  it('retries once without response_format on HTTP 400 (older llama-server compat)', async () => {
    const calls = [];
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async (url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) return { ok: false, status: 400, text: async () => 'unknown field response_format' };
      return okResponse('{"kind":"none"}');
    });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    const out = await callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: { type: 'object' } });
    expect(calls).toHaveLength(2);
    expect(calls[1].response_format).toBeUndefined();
    expect(out).toBe('{"kind":"none"}');
    spy.mockRestore();
  });

  it('still throws on non-400 HTTP errors', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'loading model' }));
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await expect(callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: { type: 'object' } }))
      .rejects.toThrow(/503/);
  });
});
