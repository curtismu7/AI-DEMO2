// demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js
import {
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
} from '../requiredDemoFlags';

// Flags any tool-dispatching chip needs. Kept in sync with
// demo_api_server/services/demoStepPrerequisites.js by the drift gate at
// demo_api_server/src/__tests__/requiredDemoFlags.parity.test.js.
const GATEWAY = ['ff_mcp_gateway_pinggateway', 'ff_gateway_brokered_exchange'];

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

  test('A2A slug alone yields the A2A flag plus the gateway flags without catalog', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation'))
      .toEqual(['ff_a2a_delegation', ...GATEWAY]);
  });

  test('UC2.5 id forces ff_a2a_delegation even when maturity is works', () => {
    expect(
      requiredFlagsForUseCase({
        id: 'UC2.5',
        useCaseId: 'a2a-orchestrator-learning',
        maturity: 'works',
      }),
    ).toEqual(['ff_a2a_delegation']);
  });
});
