import { emitHop, __setFetchForTests } from '../src/transactionHop';
import { runWithCorrelation } from '../src/correlationContext';
import { decisionFromAuditOutcome } from '../src/gatewayAudit';

describe('gateway emitHop', () => {
  const calls: Array<{ url: string; body: any; headers: any }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 'sekrit';
    __setFetchForTests(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true } as any;
    });
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  it('posts a hop stamped with the ALS correlation id and the service name', async () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason', op: 'reasoning-step-1' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://bff/internal/transaction-hop');
    expect(calls[0].body).toMatchObject({
      correlationId: 'c1',
      service: 'mcp-gateway',
      phase: 'agent.reason',
      op: 'reasoning-step-1',
    });
    expect(calls[0].headers['x-internal-gateway-secret']).toBe('sekrit');
  });

  it('forwards an optional details object into the posted hop body verbatim', async () => {
    const details = { httpStatus: 403, dpop_bound: true, alert: true, reason: 'insufficient_scope' };
    runWithCorrelation('c1', () => emitHop({ phase: 'gateway.authorize', op: 'create_transfer', details }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].body.details).toEqual(details);
  });

  it('forwards an optional vertical field into the posted hop body verbatim', async () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'gateway.authorize', op: 'create_transfer', vertical: 'retail' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].body.vertical).toBe('retail');
  });

  it('no-ops outside a correlation scope', async () => {
    emitHop({ phase: 'agent.reason' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('no-ops when the ingest URL is unset', async () => {
    delete process.env.BFF_TRANSACTION_HOP_URL;
    runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('never throws when the transport rejects', async () => {
    __setFetchForTests(async () => { throw new Error('network down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason' }))).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

describe('decisionFromAuditOutcome', () => {
  it('maps success to permit', () => {
    expect(decisionFromAuditOutcome('success')).toEqual({ outcome: 'permit', reason: 'success' });
  });

  it('maps partial (HITL pending) to n/a', () => {
    expect(decisionFromAuditOutcome('partial')).toEqual({ outcome: 'n/a', reason: 'partial' });
  });

  it('maps a failure carrying an insufficient-scope alert to deny', () => {
    const details = {
      alert: true,
      reason: 'insufficient_scope',
      requiredScopes: ['transfers:write'],
      missingScopes: ['transfers:write'],
      availableScopes: ['accounts:read'],
    };
    const result = decisionFromAuditOutcome('failure', details);
    expect(result.outcome).toBe('deny');
  });

  it('maps a failure WITHOUT an insufficient-scope alert (e.g. backend 500 / timeout) to n/a, not deny', () => {
    const details = { httpStatus: 502, dpop_bound: false, dpop_verified: false };
    const result = decisionFromAuditOutcome('failure', details);
    expect(result.outcome).toBe('n/a');
  });

  it('maps a failure with no details at all to n/a, not deny', () => {
    const result = decisionFromAuditOutcome('failure');
    expect(result.outcome).toBe('n/a');
  });

  it('distinguishes a denial from a non-authorization failure in the reason field', () => {
    const denyReason = decisionFromAuditOutcome('failure', { alert: true, reason: 'insufficient_scope' }).reason;
    const outageReason = decisionFromAuditOutcome('failure', { httpStatus: 500 }).reason;
    expect(denyReason).not.toBe(outageReason);
    expect(denyReason).toContain('insufficient_scope');
    expect(outageReason).not.toContain('insufficient_scope');
  });
});
