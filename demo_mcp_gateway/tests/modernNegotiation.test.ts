'use strict';

/**
 * MCP spec 2026-07-28: per-request version negotiation. A Modern request
 * declares its protocol version in `_meta['io.modelcontextprotocol/protocolVersion']`
 * instead of establishing it once via `initialize`. This gateway doesn't
 * implement any Modern-era behavior yet (MRTR, list caching, stateless core)
 * — only the negotiation mechanism itself: recognize a Modern-shaped
 * request and reject it cleanly with UnsupportedProtocolVersionError,
 * rather than silently processing it under Legacy semantics it never
 * declared support for. `server/discover` is exempt — its entire purpose is
 * answering regardless of what version the caller claims.
 */

import {
  extractRequestedProtocolVersion,
  buildUnsupportedProtocolVersionError,
} from '../src/modernNegotiation';

describe('extractRequestedProtocolVersion', () => {
  it('reads the modern _meta key from params', () => {
    const params = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };
    expect(extractRequestedProtocolVersion(params)).toBe('2026-07-28');
  });

  it('returns undefined when params has no _meta (an ordinary Legacy request)', () => {
    expect(extractRequestedProtocolVersion({ name: 'get_my_accounts' })).toBeUndefined();
    expect(extractRequestedProtocolVersion(undefined)).toBeUndefined();
  });

  it('returns undefined when _meta exists but has no protocolVersion key', () => {
    expect(extractRequestedProtocolVersion({ _meta: { correlationId: 'abc' } })).toBeUndefined();
  });
});

describe('buildUnsupportedProtocolVersionError', () => {
  it('builds a -32022 JSON-RPC error listing what this server actually supports', () => {
    const err = buildUnsupportedProtocolVersionError(7, '2026-07-28', ['2025-11-25']);
    expect(err).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32022,
        message: 'Unsupported protocol version',
        data: { supported: ['2025-11-25'], requested: '2026-07-28' },
      },
    });
  });
});
