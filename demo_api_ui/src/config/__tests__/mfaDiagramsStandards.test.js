import { describe, it, expect } from 'vitest';
import { CIBA_LINK_DIAGRAM, CIBA_LINK_PING_DIAGRAM } from '../cibaApprovalLinkDiagram';
import { SIM_PUSH_DIAGRAM } from '../simulatedPushDiagram';
import { SIGNIN_DIAGRAM } from '../deviceFirstSignInDiagram';

describe.each([['ciba', CIBA_LINK_PING_DIAGRAM], ['push', SIM_PUSH_DIAGRAM], ['signin', SIGNIN_DIAGRAM]])('%s ping-style detail', (_n, c) => {
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
  expect(CIBA_LINK_PING_DIAGRAM.STEPS.some((s) => s.detail.tokens?.length)).toBe(true);
  expect(SIGNIN_DIAGRAM.STEPS.some((s) => s.detail.tokens?.length)).toBe(true);
});

it('the themed CIBA diagram (ArchitectureTabsPanel) keeps its original steps, theme colours and solid arrows', () => {
  expect(CIBA_LINK_DIAGRAM.STEPS).toHaveLength(8);
  expect(CIBA_LINK_DIAGRAM.STEPS.some((s) => s.detail)).toBe(false);
  expect(CIBA_LINK_DIAGRAM.EDGES.some((e) => e[3]?.dashed)).toBe(false);
  Object.values(CIBA_LINK_DIAGRAM.GROUPS).forEach((g) => expect(g.bg).toMatch(/^var\(--th-/));
});

it('RFC 9470 (resource-server challenge) is not cited: no arrow here is a WWW-Authenticate challenge', () => {
  [CIBA_LINK_PING_DIAGRAM, SIM_PUSH_DIAGRAM, SIGNIN_DIAGRAM].forEach((c) => c.STEPS.forEach((s) => expect(s.detail.refs.map((r) => r.id)).not.toContain('RFC 9470')));
});

it('request forms name real BFF routes, not placeholders', () => {
  const forms = [CIBA_LINK_PING_DIAGRAM, SIM_PUSH_DIAGRAM, SIGNIN_DIAGRAM].flatMap((c) => c.STEPS.map((s) => s.detail.form)).join('\n');
  ['push-mock/start', 'push-mock/status', 'push-mock/decision', '/pi-flow/credentials', '/pi-flow/passwordless', '/pi-flow/device', '/pi-flow/otp', '/pi-flow/assertion'].forEach((r) => expect(forms).toContain(r));
  expect(forms).not.toMatch(/push-mock\/<id>|pi-flow\/start|<BFF pi\.flow|<PF flow>|<PF token endpoint>/);
});
