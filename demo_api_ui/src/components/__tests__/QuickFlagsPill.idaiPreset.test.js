import { isIdaiFaithful, pinnedIdaiTargets } from '../QuickFlagsPill';

describe('IDAI-faithful Quick Flags preset', () => {
  it('detects faithful flag combination', () => {
    expect(isIdaiFaithful({
      ff_mcp_gateway_pinggateway: { value: true },
      ff_authorize_simulated: { value: false },
      ff_mcp_gateway_jwks: { value: false },
    })).toBe(true);
  });

  it('rejects Demo GW or Simulated or JWKS', () => {
    expect(isIdaiFaithful({
      ff_mcp_gateway_pinggateway: { value: false },
      ff_authorize_simulated: { value: false },
      ff_mcp_gateway_jwks: { value: false },
    })).toBe(false);
    expect(isIdaiFaithful({
      ff_mcp_gateway_pinggateway: { value: true },
      ff_authorize_simulated: { value: true },
      ff_mcp_gateway_jwks: { value: false },
    })).toBe(false);
    expect(isIdaiFaithful({
      ff_mcp_gateway_pinggateway: { value: true },
      ff_authorize_simulated: { value: false },
      ff_mcp_gateway_jwks: { value: true },
    })).toBe(false);
  });

  it('lists pinned preset targets', () => {
    expect(pinnedIdaiTargets({
      ff_mcp_gateway_pinggateway: { value: true, pinned: true, pinnedBy: 'env' },
      ff_authorize_simulated: { value: false },
      ff_mcp_gateway_jwks: { value: false },
    })).toEqual([{ id: 'ff_mcp_gateway_pinggateway', pinnedBy: 'env' }]);
  });
});
