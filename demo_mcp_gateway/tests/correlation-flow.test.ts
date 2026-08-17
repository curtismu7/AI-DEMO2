import { extractCorrelationId } from '../src/correlationId';

describe('gateway correlation extraction', () => {
  it('prefers X-Correlation-ID header, then params.correlationId, else generates', () => {
    expect(extractCorrelationId({ 'x-correlation-id': 'H' }, { id: 1, params: { correlationId: 'P' } })).toBe('H');
    expect(extractCorrelationId({}, { id: 7, params: { correlationId: 'P' } })).toBe('P');
    const gen = extractCorrelationId({}, {});
    expect(typeof gen).toBe('string');
    expect(gen.length).toBeGreaterThan(0);
  });

  // Regression: the JSON-RPC id is a per-connection counter, not a correlation.
  // The BFF's WS client sends a hardcoded id (1 initialize / 2 follow-up) on
  // EVERY request, so honouring it merged every WS tool call ever made into one
  // ledger transaction keyed "2". Un-correlated requests must get a unique id.
  it('never uses the JSON-RPC id as a correlation, and does not collide across calls', () => {
    expect(extractCorrelationId({}, { id: 'rpc-9', params: {} })).not.toBe('rpc-9');
    expect(extractCorrelationId({}, { id: 42 })).not.toBe('42');

    const a = extractCorrelationId({}, { id: 2, params: {} });
    const b = extractCorrelationId({}, { id: 2, params: {} });
    expect(a).not.toBe(b);
  });
  it('handles missing headers/message objects safely', () => {
    expect(typeof extractCorrelationId(undefined, undefined)).toBe('string');
  });
});
