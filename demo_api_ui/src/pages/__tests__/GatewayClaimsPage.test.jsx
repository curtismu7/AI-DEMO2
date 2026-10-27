import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayClaimsPage from '../GatewayClaimsPage';
import { parseSequence } from '../../utils/parseSequence';
import {
  AGENT_ID, DIAGRAM_DETAILS, REQUIRED_CLAIMS, SCENARIOS, evaluateRule, flattenClaims, scenarioDiagram,
} from '../../config/gatewayClaims';

describe('flattenClaims', () => {
  it('flattens nested objects to dotted paths', () => {
    expect(flattenClaims({ a: 1, act: { sub: 'x', deep: { n: 2 } } })).toEqual({ a: 1, 'act.sub': 'x', 'act.deep.n': 2 });
  });
  it('keeps the TEXT "{}" as a leaf, so act.sub does not exist', () => {
    const flat = flattenClaims({ act: '{}' });
    expect(flat).toEqual({ act: '{}' });
    expect('act.sub' in flat).toBe(false);
  });
  it('keeps arrays as leaves and tolerates empty input', () => {
    expect(flattenClaims({ aud: ['a', 'b'] })).toEqual({ aud: ['a', 'b'] });
    expect(flattenClaims(undefined)).toEqual({});
  });
});

describe('evaluateRule scenarios', () => {
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.result]));
  it('allows only the matching token', () => {
    expect(Object.entries(by).filter(([, r]) => r.allowed).map(([id]) => id)).toEqual(['match']);
  });
  it('names the failing claim in the log line', () => {
    expect(by['wrong-act-sub'].log).toBe('workload token rejected: required claim "act.sub" does not match');
    expect(by['act-text'].log).toContain('"act.sub"');
    expect(by['no-act'].log).toContain('"act.sub"');
    expect(by['wrong-client'].log).toContain('"client_id"');
  });
  it('reports a missing claim as not present', () => {
    const c = evaluateRule(REQUIRED_CLAIMS, { client_id: AGENT_ID }).checks.find((k) => k.path === 'act.sub');
    expect(c).toMatchObject({ present: false, ok: false });
  });
  it('requires every claim, not just one', () => {
    expect(evaluateRule({ a: '1', b: '2' }, { a: '1', b: 'x' }).allowed).toBe(false);
  });
});

describe('scenario diagrams', () => {
  it.each(SCENARIOS.map((s) => [s.id, s]))('%s parses with one payload per message and reel details', (_, s) => {
    const d = scenarioDiagram(s);
    const model = parseSequence(d.source);
    const messages = model.items.filter((i) => i.from && i.to);
    expect(messages).toHaveLength(s.result.allowed ? 8 : 7);
    expect(d.payloads).toHaveLength(messages.length);
    for (const p of model.participants) expect(DIAGRAM_DETAILS[p.id]).toBeTruthy();
  });
  it('contains no real-looking hosts or ids', () => {
    const all = SCENARIOS.map((s) => scenarioDiagram(s).source + JSON.stringify(s.claims)).join('\n');
    expect(all).not.toMatch(/ping-devops|pf-route-c-test|cmuir/);
  });
});

describe('GatewayClaimsPage', () => {
  const renderPage = () => render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);

  it('has the title, back link, evidence legend and both parts', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /What Privilege gateway v1\.261024 added/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
    const legend = screen.getByTestId('gwc-legend');
    for (const l of ['VERIFIED', 'INFERRED', 'UNVERIFIED']) expect(within(legend).getByText(l)).toBeTruthy();
    expect(screen.getByTestId('gwc-posture').textContent).toMatch(/UNVERIFIED, not yet in the console API/);
    expect(screen.getByTestId('gwc-what-changed').textContent).toMatch(/binary symbol diff/i);
  });

  it('never says "door" in copy', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/\bdoors?\b/i);
  });

  it('switches scenario: verdict, flattened table and diagram follow', () => {
    renderPage();
    expect(screen.getByTestId('gwc-verdict').getAttribute('data-allowed')).toBe('true');
    fireEvent.click(screen.getByTestId('gwc-scenario-act-text'));
    expect(screen.getByTestId('gwc-verdict').getAttribute('data-allowed')).toBe('false');
    expect(screen.getByTestId('gwc-token').textContent).toContain('"act": "{}"');
    expect(within(screen.getByTestId('gwc-checks')).getAllByText('no match').length).toBe(1);
    fireEvent.click(screen.getByTestId('gwc-scenario-match'));
    expect(within(screen.getByTestId('gwc-flat')).getByText('act.sub')).toBeTruthy();
  });
});
