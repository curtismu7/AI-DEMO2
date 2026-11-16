'use strict';

/**
 * MCP spec 2026-07-28: server/discover. Mirrors demo_mcp_gateway/src/serverDiscover.ts.
 *
 * supportedVersions lists 2026-07-28 because Modern requests are genuinely
 * served end to end: per-request _meta (no initialize, no Mcp-Session-Id),
 * Mcp-Method/Mcp-Name header checks, resultType on every result, ttlMs /
 * cacheScope on the cacheable methods, per-request logLevel, and the removed
 * methods (ping, logging/setLevel) rejected — see modernRequest.ts. Legacy
 * 2025-11-25 callers keep the initialize handshake unchanged.
 */

import { CACHE_HINTS, CacheScope } from './modernRequest';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2026-07-28'] as const;

export interface DiscoverServerInfo {
  name: string;
  version: string;
}

export interface DiscoverResult {
  resultType: 'complete';
  supportedVersions: readonly string[];
  capabilities: Record<string, unknown>;
  ttlMs: number;
  cacheScope: CacheScope;
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
    ...CACHE_HINTS['server/discover'],
    _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
    ...(instructions !== undefined ? { instructions } : {}),
  };
}
