import { describe, it, expect } from 'vitest';
import { GROUP_POLICY_DIAGRAM } from '../groupPolicyBoardDiagram';

describe('group policy ping-style detail', () => {
  const { EDGES, STEPS } = GROUP_POLICY_DIAGRAM;
  it('one step per arrow', () => {
    expect(STEPS.map((s) => s.edges)).toEqual(EDGES.map((_e, i) => [i]));
  });
  it('every step has a request form and standards', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form.length).toBeGreaterThan(10);
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(['rfc', 'spec', 'emerging']).toContain(r.kind));
    });
  });
  it('mock tokens are labelled and carry claims', () => {
    const toks = STEPS.flatMap((s) => s.detail.tokens || []);
    expect(toks.length).toBeGreaterThan(0);
    toks.forEach((t) => { expect(t.note).toContain('·'); expect(t.claims).toBeTruthy(); });
    expect(JSON.stringify(STEPS)).not.toMatch(/eyJ[A-Za-z0-9]{10,}/);
  });
});
