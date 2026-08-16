'use strict';

/**
 * MCP spec 2026-07-28 mandates every server implement `server/discover`
 * (basic/server/discover: "Servers MUST implement it") — a standalone RPC
 * returning supported protocol versions, capabilities, and identity in one
 * call, usable both as a convenience for modern clients and as the
 * backward-compat probe a dual-era-aware client sends to tell a legacy
 * server apart from a modern one.
 *
 * This gateway is still Legacy-era end-to-end (2025-11-25 handshake) — only
 * `server/discover` itself is being added here. `supportedVersions` must
 * stay honestly scoped to what's actually implemented; claiming 2026-07-28
 * before the rest of Modern (stateless _meta negotiation, MRTR, list
 * caching) lands would make this RPC lie to a caller relying on it.
 */

import { buildDiscoverResult } from '../src/serverDiscover';

describe('buildDiscoverResult', () => {
  const capabilities = { tools: {}, logging: {} };
  const serverInfo = { name: 'banking-mcp-gateway', version: '1.0.0' };

  it('reports only the protocol versions actually supported end-to-end', () => {
    const result = buildDiscoverResult(capabilities, serverInfo);
    // 2026-07-28 is genuinely supported for tools/call (MRTR-shaped
    // elicitation, real and tested) — see the SUPPORTED_PROTOCOL_VERSIONS
    // docblock in src/serverDiscover.ts for exactly what's real vs partial.
    expect(result.supportedVersions).toEqual(['2025-11-25', '2026-07-28']);
  });

  it('sets resultType to complete', () => {
    const result = buildDiscoverResult(capabilities, serverInfo);
    expect(result.resultType).toBe('complete');
  });

  it('echoes the capabilities object passed in verbatim', () => {
    const result = buildDiscoverResult(capabilities, serverInfo);
    expect(result.capabilities).toBe(capabilities);
  });

  it('places serverInfo under the io.modelcontextprotocol/serverInfo _meta key', () => {
    const result = buildDiscoverResult(capabilities, serverInfo);
    expect(result._meta).toEqual({ 'io.modelcontextprotocol/serverInfo': serverInfo });
  });

  it('includes instructions when provided, omits the key when not', () => {
    const withInstructions = buildDiscoverResult(capabilities, serverInfo, 'Use tools/list to see what is available.');
    expect(withInstructions.instructions).toBe('Use tools/list to see what is available.');

    const withoutInstructions = buildDiscoverResult(capabilities, serverInfo);
    expect('instructions' in withoutInstructions).toBe(false);
  });
});
