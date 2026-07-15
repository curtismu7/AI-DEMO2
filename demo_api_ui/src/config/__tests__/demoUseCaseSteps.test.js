/**
 * demoUseCaseSteps — shared Demo script id list.
 */
import { describe, it, expect } from 'vitest';
import { DEMO_USE_CASE_IDS, DEMO_USE_CASE_LABEL } from '../demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('keeps the presenter Demo script order', () => {
    expect(DEMO_USE_CASE_IDS).toEqual([
      'UC1',
      'UC2',
      'UC2.5',
      'UC8',
      'UC7',
      'UC6',
      'UC10',
      'UC5',
      'UC13',
      'UC11',
      'UC12',
      'UC20',
    ]);
  });

  it('exports the Demo section label', () => {
    expect(DEMO_USE_CASE_LABEL).toMatch(/Demo/i);
  });
});
