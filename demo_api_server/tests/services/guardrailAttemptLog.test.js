'use strict';

// guardrailAttemptLog — in-memory ring buffer backing the Agentic Access
// Console's "Recent attempts" panel. Purely additive/observational; this
// suite only pins the buffer's own behavior (ordering, eviction cap).

describe('guardrailAttemptLog', () => {
  beforeEach(() => { jest.resetModules(); });

  test('list() returns newest first', () => {
    const log = require('../../services/guardrailAttemptLog');
    log.record({ provider: 'anthropic', prompt: 'first', verdict: 'PASSED' });
    log.record({ provider: 'openai', prompt: 'second', verdict: 'BLOCKED', reason: 'policy' });
    const [newest, oldest] = log.list();
    expect(newest.prompt).toBe('second');
    expect(newest.verdict).toBe('BLOCKED');
    expect(newest.reason).toBe('policy');
    expect(oldest.prompt).toBe('first');
    expect(oldest.reason).toBeNull();
  });

  test('caps at 20 entries (ring buffer, oldest evicted)', () => {
    const log = require('../../services/guardrailAttemptLog');
    for (let i = 0; i < 25; i++) {
      log.record({ provider: 'anthropic', prompt: `p${i}`, verdict: 'PASSED' });
    }
    const entries = log.list();
    expect(entries).toHaveLength(20);
    expect(entries[0].prompt).toBe('p24');
    expect(entries[19].prompt).toBe('p5');
  });
});
