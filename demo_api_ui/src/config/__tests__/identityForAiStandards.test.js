import { describe, it, expect } from 'vitest';
import { ID4AI_SLIDES } from '../id4aiSlides';
import { IDENTITY_FOR_AI_DETAIL } from '../identityForAiStandards';
import { IDENTITY_FOR_AI_DIAGRAM as d } from '../identityForAiDiagram';

const slide = ID4AI_SLIDES.find((s) => s.id === 'identity-for-ai');
const ids = d.NODES.map((n) => n.id);

describe('identity-for-ai slide', () => {
  it('is deck page 45, renders through the pingStyle diagram, one step per product', () => {
    expect(slide.page).toBe(45);
    expect(slide.ping).toBe(d);
    expect(slide.steps.map((s) => s[0])).toEqual(['PingOne Protect', 'PingOne Authorize', 'PingOne Privilege', 'Agent IAM Core', 'Agent Gateway', 'Agent Governance']);
  });
  it('has unique nodes in declared groups and edges between real nodes', () => {
    expect(new Set(ids).size).toBe(ids.length);
    d.NODES.forEach((n) => expect(d.GROUPS[n.group]).toBeTruthy());
    d.EDGES.forEach(([s, t]) => { expect(ids).toContain(s); expect(ids).toContain(t); });
  });
  it('steps cover every arrow exactly once, and every product has an arrow in its step', () => {
    const all = d.STEPS.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(all).toEqual(d.EDGES.map((_e, i) => i));
    d.STEPS.forEach((s) => expect(s.edges.some((i) => d.EDGES[i].slice(0, 2).includes(s.key))).toBe(true));
  });
  it('users, agents and resources sit on the edges of the product map', () => {
    ['users', 'agents', 'resources'].forEach((id) => expect(d.EDGES.some(([s, t]) => s === id || t === id)).toBe(true));
  });
  it('names where Agent IAM Core is available', () => {
    expect(d.NODES.find((n) => n.id === 'core').sub.join(' ')).toMatch(/AIC.*PingOne.*PingFederate.*AIS/);
  });
});

describe('identity-for-ai step detail', () => {
  it('every step carries its detail', () => {
    d.STEPS.forEach((s) => expect(s.detail).toBe(IDENTITY_FOR_AI_DETAIL[s.key]));
  });
  it.each(Object.entries(IDENTITY_FOR_AI_DETAIL))('%s has standards, and any form or token is well shaped', (_k, x) => {
    expect(x.refs.length).toBeGreaterThan(0);
    x.refs.forEach((r) => { expect(r.id && r.title).toBeTruthy(); expect(['rfc', 'spec', 'emerging']).toContain(r.kind); });
    if (x.form) expect(x.form.length).toBeGreaterThan(20);
    (x.tokens || []).forEach((t) => { expect(t.note).toContain(' · '); expect(t.claims).toBeTruthy(); });
  });
  it('shows no real secrets, no emoji, and keeps PingOne binding_message within 8 characters', () => {
    const text = JSON.stringify(IDENTITY_FOR_AI_DETAIL);
    expect(text).not.toMatch(/eyJ|client_secret=[^<]/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(IDENTITY_FOR_AI_DETAIL.core.form.match(/binding_message=(.{1,8})\s/)?.[1]).toBe('Pay $500');
  });
});
