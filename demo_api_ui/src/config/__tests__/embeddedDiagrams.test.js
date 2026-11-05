import { describe, it, expect } from 'vitest';
import { CONSENT_MOCK_DIAGRAM } from '../consentMockPhoneDiagram';
import { GROUP_POLICY_DIAGRAM } from '../groupPolicyBoardDiagram';
import { CIBA_LINK_DIAGRAM } from '../cibaApprovalLinkDiagram';
import { SIM_PUSH_DIAGRAM } from '../simulatedPushDiagram';
import { SIGNIN_DIAGRAM } from '../deviceFirstSignInDiagram';
import { AI_POLICIES_DIAGRAM } from '../privilegeAiPoliciesDiagram';
import { PF_TOKEN_DIAGRAM } from '../privilegePfTokenDemo';
import { NHI_ENTITY_DIAGRAM, NHI_CHECK_DIAGRAM } from '../privilegeNhiDiagrams';
import { buildFeatureDiagram } from '../privilegeFeatureDiagram';
import privilegeFeatures from '../../data/privilegeFeatures.json';

describe.each([['consentMockPhone', CONSENT_MOCK_DIAGRAM], ['groupPolicyBoard', GROUP_POLICY_DIAGRAM], ['cibaApprovalLink', CIBA_LINK_DIAGRAM], ['simulatedPush', SIM_PUSH_DIAGRAM], ['deviceFirstSignIn', SIGNIN_DIAGRAM], ['privilegeAiPolicies', AI_POLICIES_DIAGRAM], ['privilegePfToken', PF_TOKEN_DIAGRAM], ['privilegeNhiEntity', NHI_ENTITY_DIAGRAM], ['privilegeNhiChecks', NHI_CHECK_DIAGRAM], ...privilegeFeatures.map((f) => [`privilegeMap:${f.id}`, buildFeatureDiagram(f)])])('%s diagram', (_n, c) => {
  const ids = c.NODES.map((n) => n.id);
  it('has unique nodes in declared groups', () => {
    expect(new Set(ids).size).toBe(ids.length);
    c.NODES.forEach((n) => expect(c.GROUPS[n.group]).toBeTruthy());
  });
  it('every edge references nodes', () => {
    c.EDGES.forEach(([s, t]) => { expect(ids).toContain(s); expect(ids).toContain(t); });
  });
  it('every arrow names what travels or happens on it (the label shows next to its number on the line)', () => {
    c.EDGES.forEach((e, i) => expect(String(e[2] || '').trim(), `edge ${i} (${e[0]} -> ${e[1]}) has no label`).not.toBe(''));
  });
  it('steps reference real edges and cover all of them', () => {
    const covered = new Set(c.STEPS.flatMap((s) => s.edges));
    c.STEPS.forEach((s) => s.edges.forEach((e) => expect(c.EDGES[e]).toBeTruthy()));
    c.EDGES.forEach((_e, i) => expect(covered.has(i)).toBe(true));
  });
});
