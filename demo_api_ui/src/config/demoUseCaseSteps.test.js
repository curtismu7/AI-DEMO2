import { DEMO_USE_CASE_IDS } from './demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('includes UC18 (rate-limit / throttle burst) in the demo walkthrough', () => {
    expect(DEMO_USE_CASE_IDS).toContain('UC18');
  });
});
