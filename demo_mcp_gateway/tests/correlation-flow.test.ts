import { extractCorrelationId } from '../src/correlationId';

describe('gateway correlation extraction', () => {
  it('prefers X-Correlation-ID header, then params.correlationId, then JSON-RPC id, else generates', () => {
    expect(extractCorrelationId({ 'x-correlation-id': 'H' }, { id: 1, params: { correlationId: 'P' } })).toBe('H');
    expect(extractCorrelationId({}, { id: 7, params: { correlationId: 'P' } })).toBe('P');
    expect(extractCorrelationId({}, { id: 'rpc-9', params: {} })).toBe('rpc-9');
    expect(extractCorrelationId({}, { id: 42 })).toBe('42');
    const gen = extractCorrelationId({}, {});
    expect(typeof gen).toBe('string');
    expect(gen.length).toBeGreaterThan(0);
  });
  it('handles missing headers/message objects safely', () => {
    expect(typeof extractCorrelationId(undefined, undefined)).toBe('string');
  });
});
