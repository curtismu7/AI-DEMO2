'use strict';

/**
 * MCP spec 2026-07-28: per-request version negotiation.
 * Mirrors demo_mcp_gateway/src/modernNegotiation.ts.
 */

export const MODERN_PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

export function extractRequestedProtocolVersion(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const version = (meta as Record<string, unknown>)[MODERN_PROTOCOL_VERSION_META_KEY];
  return typeof version === 'string' ? version : undefined;
}

export function buildUnsupportedProtocolVersionError(
  id: string | number | null,
  requested: string,
  supported: readonly string[],
): { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data: { supported: readonly string[]; requested: string } } } {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported, requested },
    },
  };
}
