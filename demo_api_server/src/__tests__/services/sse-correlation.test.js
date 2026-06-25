'use strict';

const { runWithCorrelation } = require('../../../utils/correlationContext');
const { buildSsePayload } = require('../../../services/sseCorrelation');

describe('SSE payload correlation', () => {
  it('stamps correlation_id from ALS onto the event payload', async () => {
    await runWithCorrelation('sse-1', async () => {
      const p = buildSsePayload('token-event', { foo: 'bar' });
      expect(p.type).toBe('token-event');
      expect(p.foo).toBe('bar');
      expect(p.correlation_id).toBe('sse-1');
    });
  });
  it('omits correlation_id when no ALS scope', () => {
    const p = buildSsePayload('mcp-result', { x: 1 });
    expect(p.correlation_id).toBeUndefined();
    expect(p.type).toBe('mcp-result');
    expect(p.x).toBe(1);
  });
  it('does not mutate the input event object', async () => {
    const evt = { a: 1 };
    await runWithCorrelation('sse-2', async () => { buildSsePayload('token-event', evt); });
    expect(evt.correlation_id).toBeUndefined();
    expect(Object.keys(evt)).toEqual(['a']);
  });
  it('handles a null/undefined event safely', () => {
    expect(buildSsePayload('token-event', null).type).toBe('token-event');
    expect(buildSsePayload('mcp-result', undefined).type).toBe('mcp-result');
  });
});
