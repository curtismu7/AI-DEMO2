import { describe, it, expect } from 'vitest';
import { authorizeCallFromResult, authorizeCallFromRecent } from '../authorizeCalls';
import { ok, warn, err, idle } from '../inspectorCalls';

const PINGONE_REQUEST = { method: 'POST', url: '/v1/environments/e/decisionEndpoints/ep-1', contentType: 'application/json', body: { parameters: { Amount: 12500 } } };
const base = {
  ok: true, decision: 'PERMIT', stepUpRequired: false, consentRequired: false, hitlRequired: false,
  decisionId: 'dec-1', endpointId: 'ep-1', pingoneRequest: PINGONE_REQUEST,
  pingoneResponse: { decision: 'PERMIT', statements: [{ name: 'Allow' }] },
  policyEvalMs: 12, ruleName: 'Allow small', workerTokenCached: false, tokenEvents: [],
};
const params = { Amount: 12500, TransactionType: 'TRANSFER' };
const make = (over = {}, extra = {}) => authorizeCallFromResult({ result: { ...base, ...over }, parameters: params, preset: 'transaction', elapsedMs: 80, at: 1000, policies: [], ...extra });

describe('authorizeCallFromResult', () => {
  it('PERMIT', () => {
    const c = make();
    expect(c.status).toEqual(ok('PERMIT'));
    expect(c.src).toBe('you');
    expect(c.kind).toBe('Decision · transaction');
    expect(c.title).toBe('TRANSFER $12,500');
    expect(c.chips).toEqual([idle('Rule: Allow small'), idle('Policy eval 12 ms')]);
    expect(c.banner).toBeNull();
    expect(c.request).toEqual({ label: 'Decision request', where: 'POST ' + PINGONE_REQUEST.url, body: PINGONE_REQUEST.body });
    expect(c.response.label).toBe('PingOne Authorize response');
    expect(c.hops.map((h) => h.dir)).toEqual(['Browser → BFF', 'BFF → PingOne', 'BFF → PingOne Authorize']);
    expect(c.hops[0].ms).toBe(80);
    expect(c.hops[1].status).toEqual(ok('200'));
    expect(c.steps).toHaveLength(6);
    expect(c.steps[3].policyTree).toEqual({ policies: [], result: expect.objectContaining({ decision: 'PERMIT' }) });
    expect(c.input).toEqual({ preset: 'transaction', parameters: params });
  });

  it('DENY with step-up', () => {
    const c = make({ decision: 'DENY', stepUpRequired: true, pingoneResponse: { decision: 'DENY', statements: [{ name: 'Require MFA' }] } });
    expect(c.status).toEqual(err('DENY'));
    expect(c.banner).toEqual({ tone: 'err', title: 'Denied until the user steps up', text: 'PingOne Authorize wants a stronger sign-in. Statement: Require MFA' });
  });

  it('plain DENY lists statements', () => {
    const c = make({ decision: 'DENY', pingoneResponse: { decision: 'DENY', statements: [{ name: 'A' }, { name: 'B' }] } });
    expect(c.banner).toEqual({ tone: 'err', title: 'Denied by PingOne Authorize', text: 'A, B' });
    expect(make({ decision: 'DENY', pingoneResponse: { decision: 'DENY' } }).banner.text).toBe('No statements returned.');
  });

  it('PERMIT with hitl warns', () => {
    const c = make({ hitlRequired: true });
    expect(c.status).toEqual(warn('PERMIT · needs approval'));
    expect(c.banner).toEqual({ tone: 'warn', title: 'Permitted, with a condition', text: "The app must get the user's approval before the tool runs." });
  });

  it('502 error', () => {
    const c = authorizeCallFromResult({ error: 'Bad gateway', parameters: params, preset: 'transaction', elapsedMs: 5, at: 1 });
    expect(c.status).toEqual(err('Error'));
    expect(c.banner).toEqual({ tone: 'err', title: 'PingOne Authorize call failed', text: 'Bad gateway' });
    expect(c.hops.length).toBeGreaterThan(0);
  });

  it('titles', () => {
    expect(make({}, { preset: 'mcp', parameters: { ToolName: 'transfer' } }).title).toBe('transfer');
    expect(make({}, { preset: 'custom', parameters: {} }).title).toBe('Custom decision');
  });

  it('cached worker token skips hop 2', () => {
    const c = make({ workerTokenCached: true });
    expect(c.hops[1].status).toEqual(idle('skipped'));
    expect(c.hops[1].what).toBe('Worker token: cached, so no call was made');
  });
});

describe('authorizeCallFromRecent', () => {
  it('maps a PingOne log row', () => {
    const d = { id: 'd9', requestedAt: '2026-10-17T00:00:00Z', decisionResponse: { decision: 'DENY', statements: [{ name: 'S1' }] } };
    const c = authorizeCallFromRecent(d);
    expect(c.src).toBe('log');
    expect(c.id).toBe('recent-d9');
    expect(c.status).toEqual(err('DENY'));
    expect(c.at).toBe(Date.parse('2026-10-17T00:00:00Z'));
    expect(c.request.body.note).toBe("PingOne's recent-decisions summary doesn't include the request parameters.");
    expect(c.response.body).toBe(d);
    expect(c.tokens).toEqual([]);
    expect(c.hops).toHaveLength(1);
    expect(c.hops[0].dir).toBe('BFF → PingOne Authorize');
    expect(c.steps[0].title).toBe('Recorded by PingOne');
  });
});
