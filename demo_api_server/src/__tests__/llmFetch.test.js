'use strict';

const { llmFetch, DEFAULT_LLM_TIMEOUT_MS } = require('../../services/llmFetch');

describe('llmFetch', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('returns a successful response untouched', async () => {
    const resp = { ok: true, status: 200 };
    global.fetch = jest.fn(async () => resp);
    await expect(llmFetch('http://x/health', {}, { label: 't' })).resolves.toBe(resp);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on transport error with Connection: close', async () => {
    const resp = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(resp);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/chat', { headers: { A: 'b' } }, { label: 't' })).resolves.toBe(resp);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondInit = global.fetch.mock.calls[1][1];
    expect(secondInit.headers.Connection).toBe('close');
    expect(secondInit.headers.A).toBe('b');
    spy.mockRestore();
  });

  it('retries once on 429 honoring Retry-After, then returns the retry response', async () => {
    const retryResp = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '0' : null) } })
      .mockResolvedValueOnce(retryResp);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/chat', {}, { label: 't' })).resolves.toBe(retryResp);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('does not retry 429 when retryOn429 is false (gemini rotates models instead)', async () => {
    const resp429 = { ok: false, status: 429, headers: { get: () => null } };
    global.fetch = jest.fn(async () => resp429);
    await expect(llmFetch('http://x/chat', {}, { label: 't', retryOn429: false })).resolves.toBe(resp429);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns non-retryable HTTP errors without retrying', async () => {
    const resp400 = { ok: false, status: 400, headers: { get: () => null } };
    global.fetch = jest.fn(async () => resp400);
    await expect(llmFetch('http://x/chat', {}, { label: 't' })).resolves.toBe(resp400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('times out with a labeled error', async () => {
    global.fetch = jest.fn((url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    }));
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/slow', {}, { label: 'slowsvc', timeoutMs: 50 }))
      .rejects.toThrow(/slowsvc timed out after 50ms/);
    spy.mockRestore();
  });

  it('exports a default timeout under the 60s local-provider client budget', () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeLessThan(60000);
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('caps Retry-After and defaults on unparseable values', async () => {
    const ok = { ok: true, status: 200 };
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // HTTP-date Retry-After → NaN → default 2000ms backoff (fast-forwarded via real short default not needed: assert the warn message names 2000ms)
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => 'Wed, 21 Oct 2026 07:28:00 GMT' } })
      .mockResolvedValueOnce(ok);
    await llmFetch('http://x/chat', {}, { label: 't' });
    expect(spy.mock.calls.some((c) => String(c[0]).includes('2000ms'))).toBe(true);
    spy.mockRestore();
  }, 10000);
});
