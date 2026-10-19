import { RSP_STEP_DETAILS } from '../rspStandards';
import { RSP_EDGES, RSP_NODES, RSP_GROUPS } from '../../components/ResourceServerPlacementPage';

describe('Resource Server Placement ping-style detail', () => {
  it('has exactly one step per arrow, each with a request form and standards', () => {
    expect(RSP_STEP_DETAILS).toHaveLength(RSP_EDGES.length);
    RSP_STEP_DETAILS.forEach((s, i) => {
      expect(s.edges).toEqual([i]);
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(['rfc', 'spec', 'emerging']).toContain(r.kind));
    });
  });
  it('shows the mock step-9 token on the hop that carries it', () => {
    const t = RSP_STEP_DETAILS[3].detail.tokens[0];
    expect(t.claims.aud).toBe('banking-rs');
    expect(t.claims.act).toBeTruthy();
  });
  it('gateway token act chain nests the current actor outermost (RFC 8693)', () => {
    const act = RSP_STEP_DETAILS[2].detail.tokens[0].claims.act;
    expect(act.sub).toBe('mcp-gateway');
    expect(act.act.sub).toBe('agent1');
  });
  it('sideband steps follow the recorded mock contract and cite no invented spec', () => {
    [4, 5, 6, 7].forEach((i) => {
      const d = RSP_STEP_DETAILS[i].detail;
      expect(d.form).toMatch(/illustrative/);
      expect(d.form).not.toMatch(/"decision"/);
      d.refs.forEach((r) => expect(r.id).not.toMatch(/sideband/i));
    });
    expect(RSP_STEP_DETAILS[4].detail.form).toMatch(/"headers": \[/);
  });
  it('every node group exists', () => {
    RSP_NODES.forEach((n) => expect(RSP_GROUPS[n.group]).toBeTruthy());
  });
});
