'use strict';

/**
 * MCP spec 2026-07-28: server/discover. Servers MUST implement this RPC —
 * a standalone call returning supported protocol versions, capabilities,
 * and identity, usable as a convenience for modern clients and as the
 * backward-compat probe a dual-era-aware client uses to tell a legacy
 * server apart from a modern one.
 *
 * supportedVersions is deliberately narrow right now: this gateway is still
 * Legacy-era end-to-end (2025-11-25 initialize handshake). Only add
 * '2026-07-28' here once stateless _meta negotiation, MRTR, and list
 * caching are actually implemented — claiming it earlier would make this
 * RPC lie to a caller that trusts it.
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
