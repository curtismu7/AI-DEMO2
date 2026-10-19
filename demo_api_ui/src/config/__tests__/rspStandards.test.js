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
  it('every node group exists', () => {
    RSP_NODES.forEach((n) => expect(RSP_GROUPS[n.group]).toBeTruthy());
  });
});
