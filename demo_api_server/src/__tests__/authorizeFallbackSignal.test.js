/**
 * @file authorizeFallbackSignal.test.js
 * Locks the shape of the debug "PingOne fell back" signal emitted by both the
 * transaction and MCP authorize services (services/simulatedAuthorizeService
 * .buildAuthorizeFallbackSignal) and consumed by the UI AuthorizeFallbackListener.
 */
const { buildAuthorizeFallbackSignal } = require('../../services/simulatedAuthorizeService');

describe('buildAuthorizeFallbackSignal', () => {
  it('maps fallback_simulated -> fell_back_to_simulated', () => {
    const s = buildAuthorizeFallbackSignal('fallback_simulated', new Error('ECONNREFUSED'), 'transaction');
    expect(s).toMatchObject({
      occurred: true,
      attemptedEngine: 'pingone',
      failoverMode: 'fallback_simulated',
      effectiveAction: 'fell_back_to_simulated',
      error: 'ECONNREFUSED',
      path: 'transaction',
    });
  });

  it('maps deny -> denied and permit -> permitted', () => {
    expect(buildAuthorizeFallbackSignal('deny', new Error('x'), 'transaction').effectiveAction).toBe('denied');
    expect(buildAuthorizeFallbackSignal('permit', new Error('x'), 'transaction').effectiveAction).toBe('permitted');
  });

  it('merges extra fields (e.g. tool) for the MCP path', () => {
    const s = buildAuthorizeFallbackSignal('fallback_simulated', new Error('timeout'), 'mcp', { tool: 'create_transfer' });
    expect(s.path).toBe('mcp');
    expect(s.tool).toBe('create_transfer');
  });

  it('tolerates a non-Error argument', () => {
    expect(buildAuthorizeFallbackSignal('deny', 'boom', 'mcp').error).toBe('boom');
  });
});
