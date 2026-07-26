'use strict';
const { traceIdFromCorrelation } = require('../utils/traceIdFromCorrelation');
const { buildTraceparent } = require('../utils/outboundTracing');

describe('traceIdFromCorrelation', () => {
  test('reuses a UUID\'s hex digits as the trace-id', () => {
    const id = '3d5b456e-9de9-4091-850b-2d04fd0948b6';
    expect(traceIdFromCorrelation(id)).toBe('3d5b456e9de94091850b2d04fd0948b6');
  });

  test('hashes a non-UUID correlation id to 32 hex chars', () => {
    const out = traceIdFromCorrelation('req-42');
    expect(out).toMatch(/^[0-9a-f]{32}$/);
  });

  test('is deterministic — same input, same trace-id', () => {
    expect(traceIdFromCorrelation('req-42')).toBe(traceIdFromCorrelation('req-42'));
  });

  test('distinct inputs produce distinct trace-ids', () => {
    expect(traceIdFromCorrelation('req-1')).not.toBe(traceIdFromCorrelation('req-2'));
  });

  test('matches the trace-id buildTraceparent puts on the wire', () => {
    const id = '3d5b456e-9de9-4091-850b-2d04fd0948b6';
    const traceparent = buildTraceparent(id);
    expect(traceparent.split('-')[1]).toBe(traceIdFromCorrelation(id));
  });
});
