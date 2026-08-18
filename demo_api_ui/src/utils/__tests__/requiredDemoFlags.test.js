// demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js
import {
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
} from '../requiredDemoFlags';

// Flags any tool-dispatching chip needs. Kept in sync with
// demo_api_server/services/demoStepPrerequisites.js by the drift gate at
// demo_api_server/src/__tests__/requiredDemoFlags.parity.test.js.
const GATEWAY = ['ff_mcp_gateway_pinggateway'];

describe('requiredDemoFlags', () => {
  test('flag maturity maps to the flag id', () => {
    expect(
      requiredFlagsForUseCase({ maturity: 'flag:ff_ciba', useCaseId: 'ciba-out-of-band-approval' }),
    ).toEqual(['ff_ciba']);
  });

  test('no primaryTool means no gateway runtime flags', () => {
    // Link / edu entries dispatch nothing, so they must not drag the gateway
    // flags in — otherwise opening a learning page would arm the token path.
    expect(
      requiredFlagsForUseCase({ id: 'UC26', useCaseId: 'some-link', maturity: 'works' }),
    ).toEqual([]);
  });

  test('a chip with a primaryTool requires the gateway runtime flags', () => {
    // Without these, Exchange #2 spans multiple PingOne resources and fails
    // invalid_scope, which surfaces as "That step couldn't be completed".
    expect(
      requiredFlagsForUseCase({ id: 'UC1', useCaseId: 'x', maturity: 'works', primaryTool: 'get_balance' }),
    ).toEqual(GATEWAY);
  });

  // ff_a2a_delegation was removed — delegation is always on — so no entry or
  // slug arms it anymore. These pin the removal so it cannot creep back.
  test('A2A slug alone yields only the gateway flags without catalog', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation')).toEqual(GATEWAY);
  });

  test('UC2.5 id with maturity works and no primaryTool arms nothing', () => {
    expect(
      requiredFlagsForUseCase({
        id: 'UC2.5',
        useCaseId: 'a2a-orchestrator-learning',
        maturity: 'works',
      }),
    ).toEqual([]);
  });

  it('a2a-generalist-mismatch needs only the gateway flags', () => {
    const flags = requiredFlagsForUseCase({ useCaseId: 'a2a-generalist-mismatch', primaryTool: 'sensitive_holdings' });
    expect(flags).toEqual(GATEWAY);
    expect(flags).not.toContain('ff_a2a_delegation');
  });

  test('UC37-shaped entry arms its maturity flag plus the gateway flags, never A2A', () => {
    const flags = requiredFlagsForUseCase({
      id: 'UC37',
      useCaseId: 'verified-trust-a2a-assertion',
      maturity: 'flag:ff_verified_trust_a2a',
      primaryTool: 'get_portfolio_summary',
      a2aDelegated: true,
    });
    expect(flags).toContain('ff_verified_trust_a2a');
    expect(flags).not.toContain('ff_a2a_delegation');
  });

  test('a non-delegated entry is not dragged into requiring A2A', () => {
    expect(requiredFlagsForUseCase({ useCaseId: 'plain', primaryTool: 'get_account_balance' }))
      .not.toContain('ff_a2a_delegation');
  });
});
