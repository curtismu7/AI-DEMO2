import { describe, test, expect } from 'vitest';
import { AUTHZ_SECTIONS } from './authzSections';

describe('AUTHZ_SECTIONS', () => {
  test('has 7 sections numbered 1..7', () => {
    expect(AUTHZ_SECTIONS).toHaveLength(7);
    expect(AUTHZ_SECTIONS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('every section has id, title, concept, and a pingidentity doc link', () => {
    for (const s of AUTHZ_SECTIONS) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.concept.length).toBeGreaterThan(20);
      expect(s.docHref).toMatch(/docs\.pingidentity\.com/);
    }
  });

  test('interactive sections reference a known demoType or transaction', () => {
    const known = ['transaction', 'abac', 'indeterminate', 'payloadFilter', 'obligations', null];
    for (const s of AUTHZ_SECTIONS) {
      expect(known).toContain(s.demoType ?? null);
    }
    // The 4 new demoTypes are each present exactly once.
    const types = AUTHZ_SECTIONS.map((s) => s.demoType);
    for (const t of ['abac', 'indeterminate', 'payloadFilter', 'obligations']) {
      expect(types.filter((x) => x === t)).toHaveLength(1);
    }
  });
});
