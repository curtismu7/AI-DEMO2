import { describe, it, expect } from 'vitest';
import { demoStepNumber, demoStepLabel } from '../demoStepNumbers';

describe('UC-LEARN15 demo step number', () => {
  it('gets a number from the controls group and a stable label', () => {
    // Log the resolved number once so the presenter copy ("Demo step N") and
    // the Learning Hub chip stay in sync with the numbering config by hand.
    console.log('[jev-step] UC-LEARN15 ->', demoStepLabel('UC-LEARN15'));
    expect(demoStepNumber('UC-LEARN15')).toBeTruthy();
    expect(demoStepLabel('UC-LEARN15')).toBeTruthy();
  });
});
