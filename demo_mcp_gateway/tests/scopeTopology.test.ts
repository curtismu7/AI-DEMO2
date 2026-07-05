import { TOOL_SCOPES, getScopesForGatewayTool, getChallengeTypeForTool } from '../src/auth/toolScopes';

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
