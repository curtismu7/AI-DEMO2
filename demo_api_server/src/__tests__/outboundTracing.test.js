'use strict';

/**
 * Outbound correlation/trace propagation (utils/outboundTracing.js).
 *
 * The BFF already propagates the correlation id BFF→gateway→MCP; this interceptor
 * closes the external leg (PingOne token/exchange/introspect, banking API) by
 * stamping X-Correlation-ID / X-Request-ID / W3C traceparent onto every outbound
 * axios call, read from the correlation ALS — without overwriting existing headers.
 */

const axios = require('axios');
const { runWithCorrelation } = require('../../utils/correlationContext');
const { registerOutboundTracing, buildTraceparent } = require('../../utils/outboundTracing');

registerOutboundTracing();

// Make an axios call whose adapter short-circuits the network and returns the
// final request headers the interceptor produced.
function headersFor(initialHeaders) {
  return axios({
    url: 'http://downstream.test/x',
    method: 'get',
    headers: initialHeaders,
    adapter: async (config) => ({ data: '', status: 200, statusText: 'OK', headers: {}, config }),
  }).then((res) => res.config.headers);
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('outboundTracing — correlation propagation onto outbound axios calls', () => {
  test('stamps X-Correlation-ID, X-Request-ID, and a W3C traceparent from the ALS', async () => {
    const h = await runWithCorrelation('cid-out-123', () => headersFor());
    expect(h['X-Correlation-ID']).toBe('cid-out-123');
    expect(h['X-Request-ID']).toBe('cid-out-123');
    expect(h['traceparent']).toMatch(TRACEPARENT_RE);
  });

  test('never overwrites a header the caller already set', async () => {
    const h = await runWithCorrelation('cid-out-456', () =>
      headersFor({ 'x-correlation-id': 'caller-set', traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' }),
    );
    expect(h['x-correlation-id']).toBe('caller-set');           // untouched
    expect(h['traceparent']).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
    expect(h['X-Request-ID']).toBe('cid-out-456');              // the absent one is still added
  });

  test('no correlation context → adds nothing', async () => {
    const h = await headersFor();
    expect(h['X-Correlation-ID']).toBeUndefined();
    expect(h['traceparent']).toBeUndefined();
  });

  describe('buildTraceparent', () => {
    test('reuses a UUID correlation id as the 32-hex trace-id (keeps them visibly linked)', () => {
      const tp = buildTraceparent('1e8a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8');
      expect(tp).toMatch(TRACEPARENT_RE);
      expect(tp.split('-').length).toBeGreaterThanOrEqual(4); // version-trace-span-flags (UUID dashes were stripped)
      expect(tp).toContain('1e8a2b3c4d5e6f708192a3b4c5d6e7f8'); // UUID hex reused as trace-id
    });

    test('hashes a non-hex correlation id to a valid 32-hex trace-id', () => {
      expect(buildTraceparent('not-a-uuid-xyz')).toMatch(TRACEPARENT_RE);
    });

    test('produces a fresh span-id per call', () => {
      const a = buildTraceparent('same-id');
      const b = buildTraceparent('same-id');
      expect(a).not.toBe(b); // span-id differs even for the same correlation id
    });
  });
});
