'use strict';

const { isNodeGatewayOnlyTool, tokenResolutionOptions } = require('../../services/mcpGatewayRoutingPolicy');

describe('MCP gateway routing policy', () => {
  it('requires a PingGateway token for ordinary vertical tools regardless of selected base', () => {
    expect(tokenResolutionOptions('get_airline_bookings', true, false))
      .toEqual({ forcePingGatewayAudience: true });
    expect(tokenResolutionOptions('get_account_balance', true, false))
      .toEqual({ forcePingGatewayAudience: true });
  });

  it('requires a Node gateway token only for tools implemented there', () => {
    expect(isNodeGatewayOnlyTool('user_profile_card')).toBe(true);
    expect(tokenResolutionOptions('demo_show_accounts', true, false))
      .toEqual({ forceNodeGatewayAudience: true });
    expect(tokenResolutionOptions('get_airline_bookings', true, false))
      .not.toEqual({ forceNodeGatewayAudience: true });
  });

  it('does not override direct calls or a caller-supplied delegated token', () => {
    expect(tokenResolutionOptions('get_airline_bookings', false, false)).toBeUndefined();
    expect(tokenResolutionOptions('get_airline_bookings', true, true)).toBeUndefined();
  });
});
