import { evaluateTierDecision, parseRestrictedTools } from '../src/tierEnforce';

describe('evaluateTierDecision — mirrors decision.js Rule 3d (tier gate)', () => {
  test('PERMITs when no tier data is present (absence is not a violation)', () => {
    expect(evaluateTierDecision('create_withdrawal', true, 100, undefined, [])).toEqual({ decision: 'PERMIT' });
  });

  test('DENIEs a restricted tool for a Standard-tier caller', () => {
    const result = evaluateTierDecision('create_withdrawal', true, 100, 2000, ['create_withdrawal']);
    expect(result.decision).toBe('DENY');
  });

  test('PERMITs a non-restricted tool at any amount within the ceiling', () => {
    const result = evaluateTierDecision('create_transfer', true, 1500, 2000, ['create_withdrawal']);
    expect(result.decision).toBe('PERMIT');
  });

  test('DENIEs a write tool whose amount exceeds the tier ceiling', () => {
    const result = evaluateTierDecision('create_transfer', true, 3000, 2000, []);
    expect(result.decision).toBe('DENY');
  });

  test('does not apply the amount ceiling to non-write (read) tools', () => {
    const result = evaluateTierDecision('get_accounts', false, undefined, 2000, []);
    expect(result.decision).toBe('PERMIT');
  });
});

describe('parseRestrictedTools', () => {
  test('parses a comma-joined header', () => {
    expect(parseRestrictedTools('create_withdrawal, withdraw')).toEqual(['create_withdrawal', 'withdraw']);
  });

  test('returns [] for absent/empty header', () => {
    expect(parseRestrictedTools(undefined)).toEqual([]);
    expect(parseRestrictedTools('')).toEqual([]);
  });
});
