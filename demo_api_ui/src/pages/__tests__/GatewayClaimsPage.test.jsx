import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayClaimsPage from '../GatewayClaimsPage';
import { parseSequence } from '../../utils/parseSequence';
import {
  AGENT_ID, DIAGRAM_DETAILS, NEXT_DETAILS, NEXT_SCENARIOS, REQUIRED_CLAIMS, SCENARIOS, TIER_RULES,
  evaluateCedarScope, evaluatePfRequest, evaluateRule, evaluateTiers, flattenClaims, nextScenarioDiagram, nextWire, scenarioDiagram,
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

describe('scenario evidence labels', () => {
  it('marks only the match run VERIFIED; the "{}" text was never isolated from the mistyped value', () => {
    const ev = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.evidence]));
    expect(ev.match).toBe('verified');
    expect(ev['act-text']).toBe('inferred');
    expect(Object.values(ev).filter((e) => e === 'verified')).toHaveLength(1);
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

describe('v1.261027 models', () => {
  it('Cedar scope gate: denies SearchIndexTool without opensearch:search only when the policy is Active', () => {
    const deny = evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid opensearch:admin', state: 'Active' });
    expect(deny).toMatchObject({ allowed: false, status: 400, rpcCode: -32600 });
    expect(deny.message).toContain('action denied by policy');
    expect(evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid opensearch:admin opensearch:search', state: 'Active' }).allowed).toBe(true);
    expect(evaluateCedarScope({ tool: 'ListIndexTool', scopes: 'openid', state: 'Active' }).allowed).toBe(true);
  });
  it('a candidate policy (State "") only shadows: allowed, with the shadow log', () => {
    const r = evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid', state: '' });
    expect(r).toMatchObject({ allowed: true, status: 200, wouldDeny: true, event: 'mcp_policy_shadow_delta' });
  });
  it('PingFederate: scope= alone gets the wrong token manager and a 401; resource= gets the right one', () => {
    expect(evaluatePfRequest({ param: 'scope' })).toMatchObject({ allowed: false, status: 401, aud: 'enduser.ping.demo', hasSubAct: false });
    expect(evaluatePfRequest({ param: 'scope' }).log).toContain('token_not_found');
    expect(evaluatePfRequest({ param: 'resource' })).toMatchObject({ allowed: true, status: 200, hasSubAct: true });
  });
  it('tiers: admin 9 tools, read 3, neither 403; the scope is matched per value, never as the whole string', () => {
    expect(evaluateTiers({ scope: 'openid opensearch:admin' })).toMatchObject({ allowed: true, count: 9 });
    expect(evaluateTiers({ scope: 'openid opensearch:read' })).toMatchObject({ allowed: true, count: 3 });
    expect(evaluateTiers({ scope: 'openid' })).toMatchObject({ allowed: false, status: 403 });
    expect(evaluateTiers({ scope: 'openid opensearch:read', rules: [{ name: 'w', tools: ['x'], requiredScopes: ['openid opensearch:read'] }] }).status).toBe(403);
    expect(TIER_RULES).toHaveLength(2);
  });
  it('every scenario is labelled VERIFIED, has a diagram with one payload per message, and reel details for each lane', () => {
    expect(NEXT_SCENARIOS.every((s) => s.evidence === 'verified')).toBe(true);
    for (const s of NEXT_SCENARIOS) {
      const d = nextScenarioDiagram(s);
      const model = parseSequence(d.source);
      const messages = model.items.filter((i) => i.from && i.to);
      expect(d.payloads).toHaveLength(messages.length);
      for (const p of model.participants) expect(NEXT_DETAILS[p.id]).toBeTruthy();
    }
  });
  it('contains no real-looking hosts or ids', () => {
    const all = NEXT_SCENARIOS.map((s) => nextScenarioDiagram(s).source + JSON.stringify(nextWire(s))).join('\n');
    expect(all).not.toMatch(/ping-devops|pf-route-c-test|cmuir|01d89b06/);
  });
});

describe('GatewayClaimsPage', () => {
  const renderPage = () => render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);

  it('has the title, back link, evidence legend and both parts', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /What Privilege gateway v1\.261024, v1\.261027 and v1\.261028 added/ })).toBeTruthy();
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

  it('shows the v1.261027 section, says novelty is undiffed, and labels both results VERIFIED', () => {
    renderPage();
    const sec = screen.getByTestId('gwc-next-release');
    expect(within(sec).getByText(/Newer gateway: v1\.261027/)).toBeTruthy();
    expect(sec.textContent).toContain('Binary symbol diff of the gateway image v1.261024 against v1.261027');
    expect(within(sec).getAllByText('VERIFIED').length).toBe(2);
    expect(within(screen.getByTestId('gwc-diff')).getByText(/aipolicy\.Request\.ApprovalAction/)).toBeTruthy();
    expect(within(screen.getByTestId('gwc-diff')).getByText(/cannot say it is new in this tag/)).toBeTruthy();
    expect(screen.getByTestId('gwc-cedar').textContent).toContain('context.token.scopes.contains("opensearch:search")');
    expect(sec.textContent).toContain('State "Active"');
  });

  it('runs the v1.261027 lab: groups, verdict, full request, token, response and the shadow trap', () => {
    renderPage();
    const lab = screen.getByTestId('gwc-next-lab');
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('400');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('-32600');
    expect(within(lab).getByTestId('gwc-next-request').textContent).toContain('"tools/call"');
    fireEvent.click(screen.getByTestId('gwc-next-cedar-candidate'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-allowed')).toBe('true');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('mcp_policy_shadow_delta');
    fireEvent.click(screen.getByTestId('gwc-group-pf'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('401');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('enduser.ping.demo');
    fireEvent.click(screen.getByTestId('gwc-next-pf-resource'));
    expect(within(lab).getByTestId('gwc-next-request').textContent).toContain('resource=');
    fireEvent.click(screen.getByTestId('gwc-group-tiers'));
    fireEvent.click(screen.getByTestId('gwc-next-tier-none'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('403');
  });

  it('labels every cell of a stacked table, so the narrow layout keeps its column headings', () => {
    const { container } = renderPage();
    const stacked = container.querySelectorAll('table.gwc-table--stack');
    expect(stacked.length).toBeGreaterThanOrEqual(5);
    stacked.forEach((t) => {
      const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent);
      t.querySelectorAll('tbody tr').forEach((row) => {
        [...row.children].forEach((td, i) => expect(td.getAttribute('data-label')).toBe(heads[i]));
      });
    });
  });
});
