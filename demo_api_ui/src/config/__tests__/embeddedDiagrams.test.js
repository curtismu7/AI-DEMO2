import { describe, it, expect } from 'vitest';
import { CONSENT_MOCK_DIAGRAM } from '../consentMockPhoneDiagram';
import { GROUP_POLICY_DIAGRAM } from '../groupPolicyBoardDiagram';
import { CIBA_LINK_DIAGRAM } from '../cibaApprovalLinkDiagram';
import { SIM_PUSH_DIAGRAM } from '../simulatedPushDiagram';
import { SIGNIN_DIAGRAM } from '../deviceFirstSignInDiagram';

describe.each([['consentMockPhone', CONSENT_MOCK_DIAGRAM], ['groupPolicyBoard', GROUP_POLICY_DIAGRAM], ['cibaApprovalLink', CIBA_LINK_DIAGRAM], ['simulatedPush', SIM_PUSH_DIAGRAM], ['deviceFirstSignIn', SIGNIN_DIAGRAM]])('%s diagram', (_n, c) => {
  const ids = c.NODES.map((n) => n.id);
  it('has unique nodes in declared groups', () => {
    expect(new Set(ids).size).toBe(ids.length);
    c.NODES.forEach((n) => expect(c.GROUPS[n.group]).toBeTruthy());
  });
  it('every edge references nodes', () => {
    c.EDGES.forEach(([s, t]) => { expect(ids).toContain(s); expect(ids).toContain(t); });
  });
  it('steps reference real edges and cover all of them', () => {
    const covered = new Set(c.STEPS.flatMap((s) => s.edges));
    c.STEPS.forEach((s) => s.edges.forEach((e) => expect(c.EDGES[e]).toBeTruthy()));
    c.EDGES.forEach((_e, i) => expect(covered.has(i)).toBe(true));
  });
});
