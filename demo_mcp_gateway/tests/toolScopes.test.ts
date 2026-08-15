import { evaluateScopeDecisionUnconditionally } from '../src/auth/toolScopes';

describe('evaluateScopeDecisionUnconditionally — Rule 3 parity (decision.js:660-715), runs regardless of P1AZ state', () => {
  test("PERMITs when the bearer carries the tool's exact required scope", () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'write transfer', 0);
    expect(result.decision).toBe('PERMIT');
  });

  test('DENIEs a tool call missing a required scope, carrying only an unrelated topology scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'read', 0);
    expect(result.decision).toBe('DENY');
  });

  test('gateway-hop-scope bypass: a bearer carrying ONLY gateway:mcp:invoke (no other topology scope) is exempt from per-tool scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'gateway:mcp:invoke', 0);
    expect(result.decision).toBe('PERMIT');
  });

  test('hop-scope bypass does NOT apply once the bearer also supplies a real topology scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'gateway:mcp:invoke read', 0);
    expect(result.decision).toBe('DENY');
  });

  test('A2A delegated scope satisfies an A2A-delegated tool at act chain depth >= 2', () => {
    const permitted = evaluateScopeDecisionUnconditionally('sensitive_passenger_record', 'pnr:read', 2);
    expect(permitted.decision).toBe('PERMIT');

    const notDelegated = evaluateScopeDecisionUnconditionally('sensitive_passenger_record', 'pnr:read', 0);
    expect(notDelegated.decision).toBe('DENY');
  });

  test('A2A delegated scope alone does not satisfy a non-A2A-delegated tool', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'pnr:read', 2);
    expect(result.decision).toBe('DENY');
  });

  test('unknown tool PERMITs — unknown-tool detection belongs to the PDP (isPolicyNotFoundReason), not this backstop', () => {
    const result = evaluateScopeDecisionUnconditionally('no_such_tool', 'read write transfer', 0);
    expect(result.decision).toBe('PERMIT');
  });
});
