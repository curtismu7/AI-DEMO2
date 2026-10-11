// UC9A — the group-check PAGE step. UC9's chip proves the deny in the agent;
// UC9A opens /group-policy where the presenter flips real membership and runs
// the single check. These pin the wiring every consumer reads: the sub-step
// mapping (renders as "9A" next to UC9), its guide copy, and its search terms.
import { describe, it, expect } from 'vitest';
import {
  DEMO_SUB_STEP_IDS,
  DEMO_USE_CASE_SEARCH_TERMS,
} from '../demoUseCaseSteps';
import { DEMO_STEP_GUIDES } from '../demoStepGuides';
import { demoStepNumber, demoStepLabel } from '../demoStepNumbers';

describe('UC9A — group-check page step', () => {
  it('is registered as UC9\'s lettered sub-step and shares its step number', () => {
    expect(DEMO_SUB_STEP_IDS.UC9).toBe('UC9A');
    expect(demoStepNumber('UC9A')).toBe(demoStepNumber('UC9'));
    expect(demoStepLabel('UC9A')).toBe(`${demoStepNumber('UC9')}A`);
  });

  it('has a guide entry telling the presenter what to do on the page', () => {
    const guide = DEMO_STEP_GUIDES.UC9A;
    expect(guide).toBeTruthy();
    expect(guide.title).toMatch(/group/i);
    expect(guide.howToRun).toMatch(/group-policy/);
  });

  it('is findable in Demo Steps search', () => {
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC9A).toBeTruthy();
  });
});
