// demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js
import {
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
} from '../requiredDemoFlags';

describe('requiredDemoFlags', () => {
  test('flag maturity maps to the flag id', () => {
    expect(
      requiredFlagsForUseCase({ maturity: 'flag:ff_ciba', useCaseId: 'ciba-out-of-band-approval' }),
    ).toEqual(['ff_ciba']);
  });

  test('A2A slug alone yields ff_a2a_delegation without catalog', () => {
    expect(requiredFlagsForUseCaseId('a2a-delegation')).toEqual(['ff_a2a_delegation']);
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
