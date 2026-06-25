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
  it('getCorrelationId reflects a runWithCorrelation scope', async () => {
    await runWithCorrelation('mcp-1', async () => {
      expect(getCorrelationId()).toBe('mcp-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
});
