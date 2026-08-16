'use strict';

/**
 * MCP spec 2026-07-28: server/discover. Mirrors demo_mcp_gateway/src/serverDiscover.ts.
 *
 * supportedVersions is deliberately narrow: this server is still Legacy-era
 * end-to-end (2025-11-25 handshake). Only add '2026-07-28' once stateless
 * _meta negotiation, MRTR, and list caching are actually implemented.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25'] as const;

export interface DiscoverServerInfo {
  name: string;
  version: string;
}

export interface DiscoverResult {
  resultType: 'complete';
  supportedVersions: readonly string[];
  capabilities: Record<string, unknown>;
  _meta: { 'io.modelcontextprotocol/serverInfo': DiscoverServerInfo };
  instructions?: string;
}

export function buildDiscoverResult(
  capabilities: Record<string, unknown>,
  serverInfo: DiscoverServerInfo,
  instructions?: string,
): DiscoverResult {
  return {
    resultType: 'complete',
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities,
    _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
    ...(instructions !== undefined ? { instructions } : {}),
  };
}
