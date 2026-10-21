// Runs the REAL Cedar engine (cedar-wasm node build); nothing here is mocked.
import { describe, it, expect } from 'vitest';
import cedar from '@cedar-policy/cedar-wasm/nodejs';
import { DEFAULT_POLICIES, NO_CLAIMS_POLICY, PRESETS, SCENARIOS } from '../../config/cedarDemoScenarios';
import { buildContext, candidateRequests, claimsToEntities, evaluate, parsePolicies } from '../cedarEngine';

const run = (scn, over = {}) => evaluate(cedar, { policiesText: DEFAULT_POLICIES, claims: PRESETS[scn.preset], request: { ...scn.request, ...over } });

describe('scenarios against the real engine', () => {
  it.each(SCENARIOS.map((s) => [s.id, s]))('%s', (_id, scn) => {
    const r = run(scn);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe(scn.expect);
    expect(r.deciding.map((d) => d.id)).toEqual(scn.decidedBy);
    expect(r.evalErrors).toEqual([]);
  });

  it('a hold lifts when approval_count becomes 1, and the permit then decides', () => {
    const held = SCENARIOS.find((s) => s.id === 'hold-large');
    expect(run(held).outcome).toBe('hold');
    expect(run(held, { approvalCount: 1 }).outcome).toBe('allow');
  });

  it('the hold names its approver', () => {
    const r = run(SCENARIOS.find((s) => s.id === 'hold-large'));
    expect(r.deciding[0]).toMatchObject({ id: 's01-hold-large-fare', effect: 'forbid', approvers: 'priya' });
  });

  it('forbid beats permit: the over-cap fare is denied although a permit also applies', () => {
    const r = run(SCENARIOS.find((s) => s.id === 'cap'));
    expect(r.outcome).toBe('deny');
    expect(r.deciding.every((d) => d.effect === 'forbid')).toBe(true);
  });
});

describe('what the engine rejects', () => {
  it('rejects raw claims vocabulary (context.claims) at strict validation, naming the attribute', () => {
    const r = evaluate(cedar, { policiesText: NO_CLAIMS_POLICY, claims: PRESETS.mary, request: { action: 'mcp:Invoke', tool: 'search_docs', args: {} } });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('validate');
    expect(r.errors.join(' ')).toMatch(/attribute `claims`/);
  });

  it('reports a syntax error at the parse stage, with no evaluation', () => {
    const r = evaluate(cedar, { policiesText: 'permit (principal, action, resource when ;', claims: PRESETS.mary, request: { action: 'mcp:Invoke', tool: 'search_docs', args: {} } });
    expect(r).toMatchObject({ ok: false, stage: 'parse' });
    expect(r.errors[0]).toMatch(/unexpected token/);
  });

  it('rejects two policies sharing an @id', () => {
    const dup = `@id("a")\npermit (principal, action, resource);\n@id("a")\nforbid (principal, action, resource);`;
    expect(parsePolicies(cedar, dup)).toMatchObject({ ok: false, stage: 'parse' });
  });
});

describe('the PF claims mapping layer', () => {
  it('maps groups to principal parents, and scope plus actor into the token context', () => {
    const ents = claimsToEntities(PRESETS.finance);
    expect(ents[0].parents.map((p) => p.id)).toEqual(['analysts', 'finance']);
    const ctx = buildContext(PRESETS.travel, { tool: 'book_fare', args: { amount: '2400.4' }, approvalCount: 0 });
    expect(ctx).toMatchObject({ app: 'booking', args: { amount: 2400 }, token: { scopes: ['tools:invoke'], client_id: 'dot', actor: 'dot' } });
  });

  it('omits args.amount when blank and flags schema drift only when asked', () => {
    expect(buildContext(PRESETS.mary, { tool: 'search_docs', args: { amount: '' } }).args).toEqual({});
    const same = buildContext(PRESETS.mary, { tool: 'search_docs', args: {} });
    expect(same.pinnedHash).toBe(same.observedHash);
    const drift = buildContext(PRESETS.mary, { tool: 'search_docs', args: {}, schemaDrift: true });
    expect(drift.pinnedHash).not.toBe(drift.observedHash);
  });
});

describe('Candidate AI policy requests for the real console', () => {
  const reqs = candidateRequests(parsePolicies(cedar, DEFAULT_POLICIES).policies, { tenant: 'tenant-1', expiresAt: '2026-11-01T00:00:00Z' });

  it('makes one Candidate request per policy, never Active, in "Write Cedar" mode', () => {
    expect(reqs).toHaveLength(6);
    for (const r of reqs) expect(r).toMatchObject({ State: 'Candidate', Spec: { AuthoringMode: 'text', CandidateExpiresAt: '2026-11-01T00:00:00Z' }, ObjectMeta: { Namespace: 'default', Tenant: 'tenant-1' } });
    expect(reqs.some((r) => r.State === 'Active')).toBe(false);
  });

  it('keeps each policy text intact and gives console-safe, unique names', () => {
    const names = reqs.map((r) => r.ObjectMeta.Name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^cedar-demo-[a-z0-9_-]+$/);
    const hold = reqs.find((r) => r.ObjectMeta.Name === 'cedar-demo-s01-hold-large-fare');
    expect(hold.Spec.Cedar).toMatch(/@approvers\("priya"\)/);
    expect(hold.Spec.Cedar.trim().endsWith(';')).toBe(true);
  });

  it('uses a placeholder tenant and no expiry by default, so nothing is silently targeted', () => {
    const [r] = candidateRequests(parsePolicies(cedar, DEFAULT_POLICIES).policies);
    expect(r.ObjectMeta.Tenant).toBe('<your-tenant-id>');
    expect(r.Spec.CandidateExpiresAt).toBe('');
  });
});
