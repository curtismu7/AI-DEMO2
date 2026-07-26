import { emitHop, __setFetchForTests } from '../src/transactionHop';
import { runWithCorrelation } from '../src/correlationContext';

describe('agent-service emitHop', () => {
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
      service: 'agent-service',
      phase: 'agent.reason',
      op: 'reasoning-step-1',
    });
    expect(calls[0].headers['x-internal-gateway-secret']).toBe('sekrit');
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
