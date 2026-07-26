import { correlationFromMessage } from '../src/server/correlationFromMessage';
import { getCorrelationId, runWithCorrelation } from '../src/utils/correlationContext';

describe('mcp-server correlation extraction', () => {
  it('reads params.correlationId, then id, else generates', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } })).toBe('P');
    expect(correlationFromMessage({ id: 42 })).toBe('42');
    expect(correlationFromMessage({ id: 'rpc-x' })).toBe('rpc-x');
    const gen = correlationFromMessage({});
    expect(typeof gen).toBe('string');
    expect(gen.length).toBeGreaterThan(0);
    expect(typeof correlationFromMessage(undefined)).toBe('string');
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

  it('ignores empty and array-valued headers', () => {
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': '' })).toBe('5');
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': ['a', 'b'] })).toBe('5');
  });

  it('getCorrelationId reflects a runWithCorrelation scope', async () => {
    await runWithCorrelation('mcp-1', async () => {
      expect(getCorrelationId()).toBe('mcp-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
});
