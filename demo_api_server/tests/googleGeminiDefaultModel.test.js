/**
 * gemini-2.0-flash (and the 1.5 models) return HTTP 404 for the demo's Google key
 * (checked 2026-10-05); Gemini NL intent then failed every call. The default must be a
 * model the key can still call.
 */
'use strict';

describe('googleGeminiLlmService default model', () => {
  const realFetch = global.fetch;
  const realModel = process.env.GOOGLE_MODEL;

  afterEach(() => {
    global.fetch = realFetch;
    if (realModel === undefined) delete process.env.GOOGLE_MODEL;
    else process.env.GOOGLE_MODEL = realModel;
    jest.resetModules();
  });

  it('calls gemini-2.5-flash when no model is configured', async () => {
    delete process.env.GOOGLE_MODEL;
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }),
      };
    });
    const { callGemini } = require('../services/googleGeminiLlmService');
    await expect(callGemini([{ role: 'user', content: 'x' }], { google_api_key: 'k' })).resolves.toBe('answer');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('gemini-2.5-flash');
    expect(calls[0]).not.toContain('gemini-2.0-flash');
  });
});
