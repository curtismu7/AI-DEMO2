'use strict';

const breaker = require('../../services/llmCircuitBreaker');

describe('llmCircuitBreaker', () => {
  let nowSpy;
  let now;
  beforeEach(() => {
    breaker._resetAll();
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('stays closed below the threshold', () => {
    breaker.recordFailure('llamacpp');
    breaker.recordFailure('llamacpp');
    expect(breaker.isOpen('llamacpp')).toBe(false);
  });

  it('opens on the 3rd consecutive failure and logs a mend event', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < breaker.BREAKER_THRESHOLD; i += 1) breaker.recordFailure('llamacpp');
    expect(breaker.isOpen('llamacpp')).toBe(true);
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('breaker_open'));
    spy.mockRestore();
  });

  it('is per-provider', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('helix');
    expect(breaker.isOpen('helix')).toBe(true);
    expect(breaker.isOpen('llamacpp')).toBe(false);
    spy.mockRestore();
  });

  it('half-opens after the cooldown; a failure re-opens immediately; success closes', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('mlx');
    expect(breaker.isOpen('mlx')).toBe(true);

    now += breaker.BREAKER_COOLDOWN_MS + 1;
    expect(breaker.isOpen('mlx')).toBe(false);       // half-open probe allowed

    breaker.recordFailure('mlx');                     // probe failed
    expect(breaker.isOpen('mlx')).toBe(true);         // re-opened without needing 3 more

    now += breaker.BREAKER_COOLDOWN_MS + 1;
    breaker.recordSuccess('mlx');                     // probe succeeded
    expect(breaker.isOpen('mlx')).toBe(false);
    breaker.recordFailure('mlx');                     // fresh count after success
    breaker.recordFailure('mlx');
    expect(breaker.isOpen('mlx')).toBe(false);        // 2 < threshold again
    spy.mockRestore();
  });

  it('recordSuccess on an unknown provider is a no-op', () => {
    expect(() => breaker.recordSuccess('never-seen')).not.toThrow();
  });
});
