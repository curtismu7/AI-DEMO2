import { describe, expect, it } from 'vitest';
import { normalizeAttackEvidence } from '../attackLabEvidence';

describe('normalizeAttackEvidence', () => {
  it('preserves a real Privilege denial and reachability facts', () => {
    expect(normalizeAttackEvidence('tool_poisoning', {
      path: 'hostile MCP → Privilege MCP Gateway',
      enforcement: { component: 'Privilege', outcome: 'denied', reason: 'policy denied create_transfer' },
      modelReached: true,
      backendReached: false,
      steps: [{ label: 'create_transfer', outcome: 'denied' }],
    }, 'live-model')).toMatchObject({
      attackId: 'tool_poisoning',
      mode: 'live-model',
      enforcement: { component: 'Privilege', outcome: 'denied' },
      modelReached: true,
      backendReached: false,
    });
  });

  it('does not call local schema rejection a Privilege deny', () => {
    const evidence = normalizeAttackEvidence('schema_violation', {
      path: 'MCP client → input schema validator',
      enforcement: { component: 'MCP input schema', outcome: 'rejected', reason: 'Invalid arguments' },
      modelReached: null,
      backendReached: false,
    }, 'deterministic');

    expect(evidence.enforcement).toMatchObject({ component: 'MCP input schema', outcome: 'rejected' });
    expect(evidence.modelReached).toBeNull();
    expect(evidence.backendReached).toBe(false);
  });

  it('keeps absent or malformed verdicts as not evaluated', () => {
    expect(normalizeAttackEvidence('malicious_content', {
      path: 'Privilege LLM Gateway → provider',
      enforcement: null,
      modelReached: true,
      backendReached: null,
    }, 'live-model')).toMatchObject({
      enforcement: null,
      outcome: 'not-evaluated',
      modelReached: true,
      backendReached: null,
    });

    expect(normalizeAttackEvidence('tool_abuse', null, 'deterministic')).toMatchObject({
      enforcement: null,
      outcome: 'not-evaluated',
      modelReached: null,
      backendReached: null,
    });
  });

  it('preserves a safe request summary while normalizing evidence', () => {
    const evidence = normalizeAttackEvidence('tool_abuse', {
      requestSummary: 'get_account_balance for another owner (account_id redacted)',
    });

    expect(evidence.requestSummary).toMatch(/account_id redacted/);
  });
});
