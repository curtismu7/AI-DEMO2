import { describe, expect, it } from 'vitest';
import { briefRunError, isQuotaError, runFailureMessage } from '../a2aRunFailureMessage';

const GEMINI_429 = 'Gemini request returned 429: {\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please check your plan and billing details."\n  }\n}';

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
});
