import { describe, it, expect } from 'vitest';
import {
  DEMO_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_USE_CASE_LABEL,
  ADMIN_PRIMARY_USE_CASE_IDS,
} from '../demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('keeps the presenter Demo script order', () => {
    expect(DEMO_USE_CASE_IDS).toEqual([
      'UC24',
      'UC1',
      'UC8',
      'UC7',
      'UC14b',
      'UC14',
      'UC12',
      'UC6',
      'UC2',
      'UC2.5',
      'UC22',
      'UC5',
      'UC10',
      'UC13',
      'UC11',
      'UC20',
      'UC18',
      'UC29',
      'UC30',
      'UC31',
      'UC32',
      'UC38',
    ]);
  });

  it('exports the Demo section label', () => {
    expect(DEMO_USE_CASE_LABEL).toMatch(/Demo/i);
  });

  it('exports the admin vertical demo-steps id list', () => {
    expect(ADMIN_PRIMARY_USE_CASE_IDS).toEqual(['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6', 'ADMIN7', 'ADMIN8']);
  });

  it('DEMO_USE_CASE_IDS = primary + advanced concatenated in that order', () => {
    expect(DEMO_USE_CASE_IDS).toEqual([
      ...DEMO_PRIMARY_USE_CASE_IDS,
      ...DEMO_ADVANCED_USE_CASE_IDS,
    ]);
  });

  it('primary and advanced sets are disjoint (no id appears in both)', () => {
    const primarySet = new Set(DEMO_PRIMARY_USE_CASE_IDS);
    const overlap = DEMO_ADVANCED_USE_CASE_IDS.filter((id) => primarySet.has(id));
    expect(overlap).toEqual([]);
  });

  it('all ids are unique across the full script', () => {
    const seen = new Set();
    const dupes = [];
    for (const id of DEMO_USE_CASE_IDS) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it('all ids are non-empty strings', () => {
    for (const id of [...DEMO_USE_CASE_IDS, ...ADMIN_PRIMARY_USE_CASE_IDS]) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('primary list has 22 steps (all use cases visible)', () => {
    expect(DEMO_PRIMARY_USE_CASE_IDS).toHaveLength(22);
  });

  it('advanced list is empty (nothing hidden)', () => {
    expect(DEMO_ADVANCED_USE_CASE_IDS).toHaveLength(0);
  });

  // UC24 (Act 1 — public catalog, no token exchange) opens the script; UC1 is
  // the delegated-access step that follows it.
  it('UC24 opens the script and UC1 follows it', () => {
    expect(DEMO_PRIMARY_USE_CASE_IDS[0]).toBe('UC24');
    expect(DEMO_PRIMARY_USE_CASE_IDS[1]).toBe('UC1');
  });

  it('ADMIN ids all start with ADMIN', () => {
    for (const id of ADMIN_PRIMARY_USE_CASE_IDS) {
      expect(id).toMatch(/^ADMIN/);
    }
  });
});
