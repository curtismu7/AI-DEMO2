import { STEPS, PING_GROUPS } from '../gatewayEnforcementPing';
import { GATEWAY_ENFORCEMENT_JOURNEY_EDGES, GATEWAY_ENFORCEMENT_JOURNEY_GROUPS } from '../../components/education/gatewayEnforcementDiagram.generated';

describe('gatewayEnforcementPing', () => {
  it('covers every journey arrow exactly once, in order', () => {
    expect(STEPS.flatMap((s) => s.edges)).toEqual(GATEWAY_ENFORCEMENT_JOURNEY_EDGES.map((_, i) => i));
  });
  it('has the same group keys as the generated journey', () => {
    expect(Object.keys(PING_GROUPS).sort()).toEqual(Object.keys(GATEWAY_ENFORCEMENT_JOURNEY_GROUPS).sort());
  });
  it('gives every step a request form and standards with valid kinds', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(['rfc', 'spec', 'emerging']).toContain(r.kind));
    });
  });
  it('tokens are decoded claims with a note and no real secrets', () => {
    STEPS.flatMap((s) => s.detail.tokens || []).forEach((t) => {
      expect(t.note).toBeTruthy();
      expect(t.claims.sub).toBeTruthy();
      expect(JSON.stringify(t)).not.toMatch(/eyJ/);
    });
  });
});
