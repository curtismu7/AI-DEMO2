import { DEMO_ADVANCED_USE_CASE_IDS } from './demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('includes UC18 (rate-limit / throttle burst) in the advanced walkthrough', () => {
    expect(DEMO_ADVANCED_USE_CASE_IDS).toContain('UC18');
  });
});
