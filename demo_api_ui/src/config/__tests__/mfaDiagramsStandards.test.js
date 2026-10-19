import { describe, it, expect } from 'vitest';
import { CIBA_LINK_DIAGRAM } from '../cibaApprovalLinkDiagram';
import { SIM_PUSH_DIAGRAM } from '../simulatedPushDiagram';
import { SIGNIN_DIAGRAM } from '../deviceFirstSignInDiagram';

describe.each([['ciba', CIBA_LINK_DIAGRAM], ['push', SIM_PUSH_DIAGRAM], ['signin', SIGNIN_DIAGRAM]])('%s ping-style detail', (_n, c) => {
  it('every arrow is in exactly one step that has a request form and standards', () => {
    c.EDGES.forEach((_e, i) => {
      const owners = c.STEPS.filter((s) => s.edges.includes(i));
      expect(owners).toHaveLength(1);
      expect(owners[0].detail.form.length).toBeGreaterThan(10);
      expect(owners[0].detail.refs.length).toBeGreaterThan(0);
    });
  });
  it('refs are well formed, step keys unique, tokens carry claims', () => {
    expect(new Set(c.STEPS.map((s) => s.key)).size).toBe(c.STEPS.length);
    c.STEPS.forEach((s) => {
      s.detail.refs.forEach((r) => { expect(r.id && r.title).toBeTruthy(); expect(['rfc', 'spec', 'emerging']).toContain(r.kind); });
      (s.detail.tokens || []).forEach((t) => expect(t.claims).toBeTruthy());
    });
  });
});

it('ciba and sign-in include a MOCK token where one is in play', () => {
  expect(CIBA_LINK_DIAGRAM.STEPS.some((s) => s.detail.tokens?.length)).toBe(true);
  expect(SIGNIN_DIAGRAM.STEPS.some((s) => s.detail.tokens?.length)).toBe(true);
});
