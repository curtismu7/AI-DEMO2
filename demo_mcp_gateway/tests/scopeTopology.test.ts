import { TOOL_SCOPES, getScopesForGatewayTool, getChallengeTypeForTool } from '../src/auth/toolScopes';
import { allowedScopes, isA2aDelegatedTool, a2aDelegatedScope } from '../src/auth/scopeTopology';

describe('gateway toolScopes derives from manifest', () => {
  test('create_transfer requires write + transfer', () => {
    expect(getScopesForGatewayTool('create_transfer')).toEqual(['write', 'transfer']);
  });

  test('unknown tool falls back to [read]', () => {
    expect(getScopesForGatewayTool('no_such_tool')).toEqual(['read']);
  });

  test('create_transfer challenge type is consent (matches SoT)', () => {
    // SoT scope-topology.json: create_transfer challengeType = consent. This
    // guard drifted (expected step_up) and masked real challenge-type drift.
    expect(getChallengeTypeForTool('create_transfer')).toBe('consent');
  });

  test('create_withdrawal challenge type is step_up (matches SoT)', () => {
    expect(getChallengeTypeForTool('create_withdrawal')).toBe('step_up');
  });

  test('get_my_accounts challenge type is consent', () => {
    expect(getChallengeTypeForTool('get_my_accounts')).toBe('consent');
  });

  test('TOOL_SCOPES only contains gateway-surface tools', () => {
    expect(TOOL_SCOPES.create_transfer).toBeDefined();
    expect(TOOL_SCOPES.query_user_by_email).toBeUndefined();
    expect(TOOL_SCOPES.transfer).toBeUndefined();
  });
});

describe('scopeTopology — A2A + allowedScopes accessors (parity with demo_authz_server/scopeTopology.js)', () => {
  test('allowedScopes returns every scope name declared in the SoT', () => {
    const scopes = allowedScopes();
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
    expect(scopes.length).toBeGreaterThan(0);
  });

  test('isA2aDelegatedTool is false for an unknown tool', () => {
    expect(isA2aDelegatedTool('no_such_tool')).toBe(false);
  });

  test('isA2aDelegatedTool is true for sensitive_passenger_record (SoT-declared)', () => {
    expect(isA2aDelegatedTool('sensitive_passenger_record')).toBe(true);
  });

  test('a2aDelegatedScope returns null for a tool with no declared A2A scope', () => {
    expect(a2aDelegatedScope('no_such_tool')).toBeNull();
  });

  test('a2aDelegatedScope returns pnr:read for sensitive_passenger_record (SoT-declared)', () => {
    expect(a2aDelegatedScope('sensitive_passenger_record')).toBe('pnr:read');
  });
});
