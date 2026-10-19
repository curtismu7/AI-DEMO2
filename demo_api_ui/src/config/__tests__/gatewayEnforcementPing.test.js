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

describe('gatewayEnforcementPing accuracy against the repo', () => {
  const by = (k) => STEPS.find((s) => s.key === k).detail;
  it('decision step shows the real 428/403 JSON, not a bearer challenge', () => {
    const f = by('decision').form;
    expect(f).toMatch(/428/);
    expect(f).toMatch(/step_up_required/);
    expect(f).toMatch(/hitl_required/);
    expect(f).toMatch(/access_denied/);
    expect(f).not.toMatch(/WWW-Authenticate: Bearer/);
  });
  it('tier step is header based and has no groups claim', () => {
    const d = by('tier');
    expect(d.form).toMatch(/X-Tier-Max-Amount-Usd/);
    expect(JSON.stringify(d)).not.toMatch(/wealth-gold|"groups"/);
  });
  it('temporal step shows the iat max-age rule with a stale token', () => {
    const d = by('temporal');
    expect(d.form).toMatch(/token_too_old/);
    expect(d.tokens).toHaveLength(2);
  });
  it('rar step carries the grant in the azd envelope, not an access token', () => {
    const t = by('rar').tokens[0];
    expect(t.claims.azd.authorization_details).toBeTruthy();
    expect(t.claims.authorization_details).toBeUndefined();
    expect(JSON.stringify(by('rar').refs)).not.toMatch(/9126/);
  });
  it('result arrows do not cite bearer errors and decision does not cite token exchange', () => {
    STEPS.filter((s) => s.key.startsWith('join')).forEach((s) => expect(JSON.stringify(s.detail.refs)).not.toMatch(/6750/));
    expect(JSON.stringify(by('decision').refs)).not.toMatch(/8693/);
  });
});
