import { describe, it, expect } from 'vitest';
import { JAG_DIAGRAM, LOGIN_DIAGRAM, REQUEST_DIAGRAM, JAG_GUIDE, LOGIN_GUIDE, REQUEST_GUIDE, LOGIN_GROUPS } from './pfIdJagDiagrams';
import { PARTICIPANT_GROUPS } from './useCaseDiagrams/palette';
import { analyzeRouting } from '../test-utils/diagramRouting';
import { CALL_DETAIL, LOGIN_DETAIL } from './pfIdJagStandards';
import { CALLS } from '../utils/idJagCallSequence';

const figures = [['jag', JAG_DIAGRAM, JAG_GUIDE], ['login', LOGIN_DIAGRAM, LOGIN_GUIDE], ['request', REQUEST_DIAGRAM, REQUEST_GUIDE]];
const allDetails = [...JAG_DIAGRAM.STEPS, ...LOGIN_DIAGRAM.STEPS, ...REQUEST_DIAGRAM.STEPS].map((s) => s.detail).concat(CALL_DETAIL);
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
    const del = REQUEST_DIAGRAM.STEPS.find((s) => s.key === 'delegate').detail;
    expect(del.tokens.map((t) => t.note).join(' ')).toMatch(/subject_token of exchange 1[\s\S]*actor_token of exchange 1/);
    const jag = CALL_DETAIL[7].tokens.find((t) => t.header?.typ === 'oauth-id-jag+jwt');
    expect(Object.keys(jag.claims)).toEqual(expect.arrayContaining(['jti', 'iss', 'sub', 'aud', 'resource', 'client_id', 'scope', 'exp']));
  });
  it('matches the repo on the wire: nested act, policy-derived audience, gateway decision context, access token at sign-in', () => {
    const detail = (d, key) => d.STEPS.find((st) => st.key === key).detail;
    const delegate = detail(REQUEST_DIAGRAM, 'delegate');
    const scoped = delegate.tokens.find((t) => t.claims?.act?.act).claims;
    expect(scoped.act.sub).toBeTruthy();
    expect(scoped.act.act.sub).toBeTruthy();
    expect(delegate.form).not.toMatch(/&audience=/);
    expect(delegate.form).toMatch(/requested_token_type=urn:ietf:params:oauth:token-type:access_token/);
    expect(delegate.form).toMatch(/&client_id=/);
    const gateway = [JAG_DIAGRAM.STEPS.find((st) => st.edges[0] === 7).detail.form, detail(REQUEST_DIAGRAM, 'policy').form];
    gateway.forEach((f) => { expect(f).toContain('McpToolCall'); expect(f).not.toContain('McpFirstTool'); expect(f).toContain('ActChainDepth'); });
    expect(detail(LOGIN_DIAGRAM, 'exchange').tokens.map((t) => t.note).join(' ')).toMatch(/Access token[\s\S]*ID token[\s\S]*Refresh token/);
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

// The login half and the AI-request half replace one figure of 8 boxes and 19 arrows. A request/response pair between the
// same two boxes is one arrow (the router cannot keep an A-to-B and a B-to-A arrow from crossing), so nothing is lost:
// every one of the original 19 hops still has its wire detail, in the arrow that stands for it.
describe('login and request figures', () => {
  const both = [['login', LOGIN_DIAGRAM], ['request', REQUEST_DIAGRAM]];

  it('keeps all 19 hops of the original figure in the detail of the arrows that replace them', () => {
    const forms = [...LOGIN_DIAGRAM.STEPS, ...REQUEST_DIAGRAM.STEPS].map((s) => s.detail.form).join('\n');
    expect(LOGIN_DIAGRAM.EDGES.length + REQUEST_DIAGRAM.EDGES.length).toBeLessThan(19);
    LOGIN_DETAIL.forEach((d) => expect(forms).toContain(d.form));
  });

  it('uses the shared G palette tokens only, with no coloured arrows and no emoji', () => {
    const tokens = new Set(Object.values(PARTICIPANT_GROUPS).map((g) => g.bg));
    Object.values(LOGIN_GROUPS).forEach((g) => expect(tokens.has(g.bg), g.label).toBe(true));
    both.forEach(([, d]) => {
      expect(d.GROUPS).toBe(LOGIN_GROUPS);
      d.EDGES.forEach(([, , , opts]) => expect(opts?.color).toBeUndefined());
      expect(JSON.stringify({ n: d.NODES, e: d.EDGES })).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });

  // The router re-runs on every drop with all boxes as obstacles, so a drag is one box at a new position.
  const NUDGES = [[120, 0], [-120, 0], [0, 50], [0, -50], [60, 40], [-60, -40], [0, 100], [0, -100], [200, 80], [-200, -80]];
  describe.each(both)('%s routing', (_name, { NODES, EDGES }) => {
    it('routes every arrow around the boxes with 0 crossings at rest', () => {
      const r = analyzeRouting(NODES, EDGES);
      expect(r.fallbacks).toBe(0);
      expect(r.throughBox).toBe(0);
      expect(r.pairs).toEqual([]);
      expect(r.crossings).toBe(0);
    });
    const drags = NODES.flatMap((n) => NUDGES.map(([dx, dy]) => [n.id, dx, dy]));
    it.each(drags)('0 crossings after dragging %s by (%i, %i)', (id, dx, dy) => {
      const moved = NODES.map((n) => (n.id === id ? { ...n, x: n.x + dx, y: n.y + dy } : n));
      const r = analyzeRouting(moved, EDGES);
      expect(r.fallbacks).toBe(0);
      expect(r.throughBox).toBe(0);
      expect(r.crossings, JSON.stringify(r.pairs)).toBe(0);
    });
  });
});
