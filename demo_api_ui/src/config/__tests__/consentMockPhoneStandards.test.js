import { describe, it, expect } from 'vitest';
import { CONSENT_MOCK_DIAGRAM } from '../consentMockPhoneDiagram';
import { CONSENT_MOCK_DETAIL } from '../consentMockPhoneStandards';

describe('consentMockPhone ping-style detail', () => {
  const { STEPS, EDGES } = CONSENT_MOCK_DIAGRAM;
  it('has one step per arrow, each with a request form and standards', () => {
    expect(STEPS).toHaveLength(EDGES.length);
    STEPS.forEach((s, i) => {
      expect(s.edges).toEqual([i]);
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
    });
  });
  it('every ref is well formed and every step key has detail', () => {
    STEPS.forEach((s) => expect(CONSENT_MOCK_DETAIL[s.key]).toBe(s.detail));
    Object.values(CONSENT_MOCK_DETAIL).flatMap((d) => d.refs).forEach((r) => {
      expect(r.id && r.title).toBeTruthy();
      expect(['rfc', 'spec', 'emerging']).toContain(r.kind);
    });
  });
  it('real-run arrows are dashed (blue) and no step claims a token', () => {
    [4, 5].forEach((i) => expect(EDGES[i][3]).toEqual({ dashed: true }));
    expect(Object.values(CONSENT_MOCK_DETAIL).flatMap((d) => d.tokens || [])).toHaveLength(0);
  });
  it('mock tokens carry claims and a note', () => {
    Object.values(CONSENT_MOCK_DETAIL).flatMap((d) => d.tokens || []).forEach((t) => {
      expect(t.note).toContain('·');
      expect(Object.keys(t.claims).length).toBeGreaterThan(0);
    });
  });
});
