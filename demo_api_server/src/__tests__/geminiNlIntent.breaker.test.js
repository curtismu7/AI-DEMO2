'use strict';

/**
 * Phase 2: when a provider's circuit breaker is open, the NL-intent branch
 * skips the provider entirely and returns the same shape as a provider error
 * (heuristic result, silent) — the mode picker and agent mode are untouched.
 *
 * Arrangement mirrors geminiNlIntent.llmOnly.test.js: mock nlIntentParser and
 * configStore so heuristic + config resolution are deterministic, and call
 * parseNaturalLanguage with the real (message, context, provider,
 * langchainConfig) signature — the LLAMACPP branch needs no config, so a
 * kind:'none' heuristic result plus provider:'llamacpp' is enough to reach it.
 *
 * Note: unlike helix (imported statically at the top of geminiNlIntent.js),
 * llamacppLlmService is require()'d dynamically inside the branch body on
 * every call. This repo's global setup.js runs `jest.resetModules()` in
 * afterEach, which would decouple a top-level `require(...).callLlamaCpp`
 * reference from what the source fetches on the next test. Re-require it in
 * beforeEach (after that reset has already run) to stay in sync.
 */

jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(() => ({ kind: 'none', message: '' })),
  EDU: {},
  resolveVerticalRouting: jest.fn(() => ({ verticalId: 'banking', verticalCtx: null })),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));

const breaker = require('../../services/llmCircuitBreaker');
const resultCache = require('../../services/nlIntentResultCache');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

describe('geminiNlIntent circuit breaker', () => {
  let callLlamaCpp;

  beforeEach(() => {
    breaker._resetAll();
    // geminiNlIntent caches successful non-heuristic answers, so a repeat of the
    // same free-text skips the provider entirely. Every test here counts provider
    // calls, so the cache must start empty.
    resultCache.clear();
    callLlamaCpp = require('../../services/llamacppLlmService').callLlamaCpp;
    callLlamaCpp.mockReset();
  });

  const ask = () => parseNaturalLanguage(
    'please do something no heuristic understands xyzzy',
    { role: 'user' },
    'llamacpp',
    {},
  );

  it('three consecutive provider failures open the breaker; the 4th request never calls the provider', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    callLlamaCpp.mockRejectedValue(new Error('ECONNREFUSED'));
    await ask();
    await ask();
    await ask();
    expect(callLlamaCpp).toHaveBeenCalledTimes(3);

    const res = await ask();                          // breaker now open
    expect(callLlamaCpp).toHaveBeenCalledTimes(3);    // provider NOT called again
    expect(res.source).toBe('heuristic');
    expect(res.breaker_open).toBe(true);
    expect(res.llm_attempted).toBe(false);
    spy.mockRestore();
  });

  it('a successful call resets the failure count', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    callLlamaCpp.mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('{"kind":"banking","banking":{"action":"accounts"}}');
    await ask();
    await ask();
    const ok = await ask();                           // success — resets count
    expect(ok.source).toBe('llamacpp');
    // That success is now cached under this message's key; without clearing it the
    // asks below would be served from cache, never reach the provider, and record
    // no failures — the breaker would stay closed for the wrong reason.
    resultCache.clear();
    callLlamaCpp.mockRejectedValue(new Error('boom'));
    await ask();
    await ask();
    const res = await ask();                          // only 2 consecutive failures + this 3rd one opens it
    expect(breaker.isOpen('llamacpp')).toBe(true);
    expect(res.source).toBe('heuristic');             // this 3rd failing call still went to the provider
    spy.mockRestore();
  });
});
