'use strict';

/**
 * MCP spec 2026-07-28: per-request version negotiation. A Modern request
 * declares its protocol version in `_meta['io.modelcontextprotocol/protocolVersion']`
 * on every call instead of establishing one via `initialize`. This gateway
 * doesn't implement any Modern-era behavior yet (MRTR, list caching,
 * stateless core) — only the negotiation mechanism: recognize a
 * Modern-shaped request and reject it cleanly with
 * UnsupportedProtocolVersionError, rather than silently processing it
 * under Legacy semantics it never declared support for.
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
