import { correlationFromMessage } from '../src/server/correlationFromMessage';
import { getCorrelationId, runWithCorrelation } from '../src/utils/correlationContext';

describe('mcp-server correlation extraction', () => {
  it('reads params.correlationId, else generates', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } })).toBe('P');
    const gen = correlationFromMessage({});
    expect(typeof gen).toBe('string');
    expect(gen.length).toBeGreaterThan(0);
    expect(typeof correlationFromMessage(undefined)).toBe('string');
  });

  // Regression: the JSON-RPC id is a per-connection counter, not a correlation.
  // Honouring it merged unrelated transactions into a single ledger record.
  it('never uses the JSON-RPC id as a correlation, and does not collide across calls', () => {
    expect(correlationFromMessage({ id: 42 })).not.toBe('42');
    expect(correlationFromMessage({ id: 'rpc-x' })).not.toBe('rpc-x');
    expect(correlationFromMessage({ id: 2 })).not.toBe(correlationFromMessage({ id: 2 }));
  });

  it('reads x-correlation-id from headers when params.correlationId is absent', () => {
    expect(correlationFromMessage({ id: 7 }, { 'x-correlation-id': 'H1' })).toBe('H1');
  });

  it('falls back to x-request-id when x-correlation-id is absent', () => {
    expect(correlationFromMessage({ id: 7 }, { 'x-request-id': 'H2' })).toBe('H2');
  });

  it('prefers an explicit params.correlationId over the header', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } }, { 'x-correlation-id': 'H' })).toBe('P');
  });

  it('prefers a header over the JSON-RPC id — the id is a local counter, not a correlation', () => {
    expect(correlationFromMessage({ id: 1 }, { 'x-correlation-id': 'H' })).toBe('H');
  });

  it('ignores empty and array-valued headers, falling through to a generated id', () => {
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': '' })).not.toBe('5');
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': ['a', 'b'] })).not.toBe('5');
  });

  it('getCorrelationId reflects a runWithCorrelation scope', async () => {
    await runWithCorrelation('mcp-1', async () => {
      expect(getCorrelationId()).toBe('mcp-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
});
