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
});
