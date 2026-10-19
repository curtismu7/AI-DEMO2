import { describe, it, expect } from 'vitest';
import { ID4AI_SLIDES } from '../id4aiSlides';
import { IDENTITY_FOR_AI_DETAIL } from '../identityForAiStandards';

const slide = ID4AI_SLIDES.find((s) => s.id === 'identity-for-ai');

describe('identity-for-ai slide', () => {
  it('is deck page 45 with one step per product', () => {
    expect(slide.page).toBe(45);
    expect(slide.steps.map((s) => s[0])).toEqual(['PingOne Protect', 'PingOne Authorize', 'PingOne Privilege', 'Agent IAM Core', 'Agent Gateway', 'Agent Governance']);
  });
  it('lights exactly one product node per step, and Users, Agents, Resources have none', () => {
    slide.steps.forEach((_s, i) => expect(slide.config.nodes.filter((n) => n.steps?.includes(i + 1)).map((n) => n.id)).toHaveLength(1));
    ['users', 'agents', 'resources'].forEach((id) => expect(slide.config.nodes.find((n) => n.id === id).steps).toBeUndefined());
  });
  it('names where Agent IAM Core is available', () => {
    expect(slide.config.nodes.find((n) => n.id === 'core').sub).toMatch(/AIC.*PingOne.*PingFederate.*AIS/);
  });
});

describe('identity-for-ai step detail', () => {
  it('has detail for every step, carried on the step', () => {
    expect(IDENTITY_FOR_AI_DETAIL).toHaveLength(slide.steps.length);
    slide.steps.forEach((s, i) => expect(s[2]).toBe(IDENTITY_FOR_AI_DETAIL[i]));
  });
  it.each(IDENTITY_FOR_AI_DETAIL.map((d, i) => [i + 1, d]))('step %i has a request form and standards', (_n, d) => {
    expect(d.form.length).toBeGreaterThan(20);
    expect(d.refs.length).toBeGreaterThan(0);
    d.refs.forEach((r) => { expect(r.id && r.title).toBeTruthy(); expect(['rfc', 'spec', 'emerging']).toContain(r.kind); });
    (d.tokens || []).forEach((t) => { expect(t.note).toContain(' · '); expect(t.claims).toBeTruthy(); });
  });
  it('shows no real secrets', () => {
    expect(JSON.stringify(IDENTITY_FOR_AI_DETAIL)).not.toMatch(/eyJ|client_secret=[^<]/);
  });
});
