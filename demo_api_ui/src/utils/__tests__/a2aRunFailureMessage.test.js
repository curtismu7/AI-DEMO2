import { assert, describe, expect, it } from 'vitest';
import { briefRunError, isOverloadedError, isQuotaError, runFailureMessage } from '../a2aRunFailureMessage';

const GEMINI_429 = 'Gemini request returned 429: {\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please check your plan and billing details."\n  }\n}';

const GEMINI_503 = 'Gemini request returned 503: {\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary.",\n    "status": "UNAVAILABLE"\n  }\n}';
const TIMED_OUT = 'The model did not answer within 30 s, after two tries. It may be overloaded; try again.';

describe('runFailureMessage', () => {
  it('explains a 429 in plain words and says which setting to change', () => {
    const msg = runFailureMessage('Demo step 25A', GEMINI_429);

    expect(msg).toContain('Demo step 25A — the run failed');
    expect(msg).toContain('429');
    expect(msg).toMatch(/quota or rate limit is used up/);
    expect(msg).toContain('MAIN_AGENT_PROVIDER');
    // The chat's LLM picker does not drive this run; say so, or the wrong thing gets switched.
    expect(msg).toMatch(/does not use the chat.s LLM picker/);
    expect(msg).not.toContain('{');
  });

  it('recognises the usual quota and rate-limit wordings, and nothing else', () => {
    for (const e of ['HTTP 429', 'You exceeded your current quota', 'rate limit reached', 'Too Many Requests', 'RESOURCE_EXHAUSTED']) {
      expect(isQuotaError(e)).toBe(true);
    }
    for (const e of ['The A2A service is unavailable.', 'gateway refused the call', 'HTTP 502', '', undefined]) {
      expect(isQuotaError(e)).toBe(false);
    }
  });

  it('keeps any other failure to one short line with the reason', () => {
    expect(runFailureMessage('Step 26', 'gateway refused the call')).toBe('Step 26 — the run failed: gateway refused the call.');
    expect(runFailureMessage('Step 26', undefined)).toBe('Step 26 — the run failed: unknown error.');
  });

  it('collapses a long multi-line error and caps its length', () => {
    const long = `first line\n${'x'.repeat(400)}`;
    const out = briefRunError(long);
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith('…')).toBe(true);
  });

  it('a 503 says the model is overloaded and temporary, and to try again, not to wait for a quota', () => {
    const msg = runFailureMessage('Demo step 25A', GEMINI_503);

    expect(msg).toContain('Demo step 25A — the run failed');
    expect(msg).toMatch(/overloaded right now/);
    expect(msg).toMatch(/temporary and not a problem with the demo/);
    expect(msg).toMatch(/Try again in a minute/);
    expect(msg).toContain('MAIN_AGENT_PROVIDER');
    expect(msg).toMatch(/does not use the chat.s LLM picker/);
    // It must not read as a quota problem, and it carries no raw JSON.
    expect(msg).not.toMatch(/quota or rate limit is used up/);
    expect(msg).not.toContain('{');
  });

  it('the agent\'s own "did not answer in time" error is treated as an overload', () => {
    expect(isOverloadedError(TIMED_OUT)).toBe(true);
    expect(runFailureMessage('Step 26', TIMED_OUT)).toMatch(/Try again in a minute/);
  });

  it('quota (429) and overload (503) are told apart, and quota wins when text matches both', () => {
    expect(isQuotaError(GEMINI_429)).toBe(true);
    expect(isOverloadedError(GEMINI_429)).toBe(false);
    expect(isOverloadedError(GEMINI_503)).toBe(true);
    expect(isQuotaError(GEMINI_503)).toBe(false);
    // A 503 whose text also mentions a quota is a quota problem: the advice differs.
    const both = 'Gemini request returned 503: quota exceeded, service overloaded';
    expect(isQuotaError(both)).toBe(true);
    expect(isOverloadedError(both)).toBe(false);
    expect(runFailureMessage('Step 25A', both)).toMatch(/Wait for the quota to reset/);
  });

  it('other failures, including the BFF\'s "unreachable" text, are not mistaken for an overload', () => {
    for (const e of ['The A2A agent is unreachable. It may be restarting; try again in a few seconds.', 'The A2A service is unavailable.', 'gateway refused the call', 'HTTP 502', undefined]) {
      assert(!isOverloadedError(e), String(e));
    }
  });
});
