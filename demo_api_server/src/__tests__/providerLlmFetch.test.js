'use strict';

/**
 * Phase 2: the four bare provider clients route their completion calls
 * through the shared llmFetch ladder. We assert the observable behaviors the
 * ladder adds (timeout label, transport retry) without duplicating
 * llmFetch's own unit tests.
 */

describe('providers use llmFetch', () => {
  const realFetch = global.fetch;
  beforeEach(() => { jest.resetModules(); });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LLAMACPP_MODEL;
    delete process.env.MLX_LM_MODEL;
    delete process.env.LLM_FETCH_TIMEOUT_MS;
  });

  const okCompletion = (content) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('llama.cpp: transport error is retried once and succeeds', async () => {
    process.env.LLAMACPP_MODEL = 'test-model';
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('socket reset'))
      .mockResolvedValueOnce(okCompletion('hi'));
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await expect(callLlamaCpp([{ role: 'user', content: 'x' }])).resolves.toBe('hi');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('LM Studio: hung socket times out with a labeled error instead of hanging', async () => {
    global.fetch = jest.fn((url, init) => {
      if (String(url).endsWith('/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'm1' }] }) });
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    });
    // llmFetch reads its timeout from LLM_FETCH_TIMEOUT_MS at module load time;
    // set it before require() so a hung socket aborts fast in a unit test
    // instead of waiting out the real 55s DEFAULT_LLM_TIMEOUT_MS.
    process.env.LLM_FETCH_TIMEOUT_MS = '50';
    const { callLmStudio } = require('../../services/lmStudioLlmService');
    await expect(callLmStudio([{ role: 'user', content: 'x' }])).rejects.toThrow(/LM Studio timed out after/);
  });

  it('mlx: 400 response is returned to caller unchanged (error format preserved)', async () => {
    process.env.MLX_LM_MODEL = 'test-model';
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' }));
    const { callMlx } = require('../../services/mlxLlmService');
    await expect(callMlx([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/mlx-lm chat\/completions failed: 400 bad request/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // 400 is not retryable
  });

  it('gemini: 429 rotates to the next model without an internal 429 retry', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: 'quota' } }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }) };
    });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { callGemini } = require('../../services/googleGeminiLlmService');
    await expect(callGemini([{ role: 'user', content: 'x' }], { google_api_key: 'k', google_model: 'gemini-2.0-flash' }))
      .resolves.toBe('answer');
    expect(calls).toHaveLength(2);            // one call per model — no internal 429 retry
    expect(calls[0]).toContain('gemini-2.0-flash');
    expect(calls[1]).not.toContain('gemini-2.0-flash:'); // rotated to a different model
    spy.mockRestore();
  });

  it('model discovery fetches are timeout-guarded (hung /models cannot hang the call)', async () => {
    process.env.LLM_FETCH_TIMEOUT_MS = '50'; // module default only affects completion; discovery uses explicit 5000 — so instead prove the abort signal is WIRED: assert fetch received a signal
    jest.resetModules();
    let modelsInit;
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).endsWith('/models')) {
        modelsInit = init;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1' }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) };
    });
    const { callLmStudio } = require('../../services/lmStudioLlmService');
    await callLmStudio([{ role: 'user', content: 'x' }]);
    expect(modelsInit.signal).toBeDefined(); // bare fetch had no signal; llmFetch always sets one
    delete process.env.LLM_FETCH_TIMEOUT_MS;
  });
});
