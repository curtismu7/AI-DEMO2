import { describe, it, expect } from 'vitest';
import { JAG_DIAGRAM, LOGIN_DIAGRAM, JAG_GUIDE, LOGIN_GUIDE } from './pfIdJagDiagrams';
import { CALL_DETAIL } from './pfIdJagStandards';
import { CALLS } from '../utils/idJagCallSequence';

const figures = [['jag', JAG_DIAGRAM, JAG_GUIDE], ['login', LOGIN_DIAGRAM, LOGIN_GUIDE]];
const allDetails = [...JAG_DIAGRAM.STEPS, ...LOGIN_DIAGRAM.STEPS].map((s) => s.detail).concat(CALL_DETAIL);
const REF_KINDS = ['rfc', 'spec', 'emerging'];

describe.each(figures)('%s diagram config', (_name, { GROUPS, NODES, EDGES, STEPS }, guide) => {
  it('has valid node and edge ids and known groups', () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeTruthy());
    EDGES.forEach(([a, b]) => { expect(ids).toContain(a); expect(ids).toContain(b); });
  });
  it('gives every arrow exactly one step with detail, and the guide covers every arrow once', () => {
    EDGES.forEach((_e, i) => expect(STEPS.filter((s) => s.edges.includes(i))).toHaveLength(1));
    STEPS.forEach((s) => { expect(s.detail).toBeTruthy(); expect(s.detail.refs.length).toBeGreaterThan(0); });
    expect(guide.flatMap((g) => g.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_e, i) => i));
  });
});

describe('step and call detail', () => {
  it('covers all 19 calls', () => expect(CALL_DETAIL).toHaveLength(CALLS.length));
  it('has standards with kind, id and title, no duplicates, and marks emerging work', () => {
    allDetails.forEach((d) => {
      const ids = d.refs.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      d.refs.forEach((r) => { expect(REF_KINDS).toContain(r.kind); expect(r.id).toBeTruthy(); expect(r.title).toBeTruthy(); });
    });
    expect(allDetails.some((d) => d.refs.some((r) => r.kind === 'emerging'))).toBe(true);
  });
  it('says why when no token is in play', () => {
    allDetails.filter((d) => !d.tokens?.length).forEach((d) => expect(d.form).toMatch(/No token in play: \S/));
  });
  it('labels tokens, and carries no JWT literals or real secrets', () => {
    allDetails.forEach((d) => (d.tokens || []).forEach((t) => { expect(t.note).toBeTruthy(); expect(t.claims).toBeTruthy(); }));
    expect(JSON.stringify(allDetails)).not.toMatch(/eyJ|client_secret=|Bearer [A-Za-z0-9._-]{20,}/);
  });
  it('shows both input tokens of the two-exchange delegation and the ID-JAG shape', () => {
    const del = LOGIN_DIAGRAM.STEPS.find((s) => s.edges[0] === 11).detail;
    expect(del.tokens.map((t) => t.note).join(' ')).toMatch(/subject_token of exchange 1[\s\S]*actor_token of exchange 1/);
    const jag = CALL_DETAIL[7].tokens.find((t) => t.header?.typ === 'oauth-id-jag+jwt');
    expect(Object.keys(jag.claims)).toEqual(expect.arrayContaining(['jti', 'iss', 'sub', 'aud', 'resource', 'client_id', 'scope', 'exp']));
  });
  it('matches the repo on the wire: nested act, policy-derived audience, gateway decision context, access token at sign-in', () => {
    const login = (i) => LOGIN_DIAGRAM.STEPS.find((st) => st.edges[0] === i).detail;
    const scoped = login(12).tokens[0].claims;
    expect(scoped.act.sub).toBeTruthy();
    expect(scoped.act.act.sub).toBeTruthy();
    const exchange = login(11).form;
    expect(exchange).not.toMatch(/&audience=/);
    expect(exchange).toMatch(/requested_token_type=urn:ietf:params:oauth:token-type:access_token/);
    expect(exchange).toMatch(/&client_id=/);
    const gateway = [JAG_DIAGRAM.STEPS.find((st) => st.edges[0] === 7).detail.form, login(14).form];
    gateway.forEach((f) => { expect(f).toContain('McpToolCall'); expect(f).not.toContain('McpFirstTool'); expect(f).toContain('ActChainDepth'); });
    expect(login(6).tokens.map((t) => t.note).join(' ')).toMatch(/Access token[\s\S]*ID token[\s\S]*Refresh token/);
    expect(CALL_DETAIL[3].tokens.map((t) => t.note).join(' ')).toMatch(/Access token/);
  });
  it('attaches a standard only to hops it governs, and invents no spec names', () => {
    const ids = allDetails.flatMap((d) => d.refs.map((r) => r.id));
    expect(ids).not.toContain('OpenID AuthZEN');
    expect(ids.filter((id) => /^PingFederate (refresh token|OAuth assertion)/.test(id))).toEqual([]);
    allDetails.filter((d) => d.refs.some((r) => r.id === 'RFC 8707')).forEach((d) => expect(d.form).toMatch(/resource/));
    allDetails.filter((d) => d.refs.some((r) => r.id === 'PingOne Authorize')).forEach((d) => expect(d.form).toMatch(/decisionEndpoints|PingOne Authorize/));
  });
});
