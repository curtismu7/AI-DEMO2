'use strict';

/**
 * MCP spec 2026-07-28: stateless ("Modern") request handling.
 *
 * A Modern request carries everything the server needs in params._meta — no
 * initialize handshake, no Mcp-Session-Id. This module holds the pure pieces:
 * _meta validation, Streamable HTTP routing-header checks, per-method cache
 * hints and result decoration. index.ts wires them in; Legacy (2025-11-25)
 * traffic never reaches any of this, because every entry point is gated on
 * the request declaring io.modelcontextprotocol/protocolVersion.
 *
 * Spec: modelcontextprotocol.io/specification/2026-07-28/basic/index.md#meta,
 * .../basic/transports/streamable-http.md, .../server/utilities/caching.md.
 */

import { MODERN_PROTOCOL_VERSION_META_KEY } from './modernNegotiation';
import { isValidLogLevel, McpLogLevel } from './mcpLogging';

/** The protocol revision whose stateless semantics this module implements. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_LOG_LEVEL = 'io.modelcontextprotocol/logLevel';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC code for a Streamable HTTP header that is missing or disagrees with the body. */
export const ERR_HEADER_MISMATCH = -32020;
export const ERR_INVALID_PARAMS = -32602;

export interface ModernError {
  code: number;
  message: string;
}

function metaOf(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const meta = (params as { _meta?: unknown })._meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : undefined;
}

/**
 * Validate the per-request _meta of a request already known to be Modern
 * (it declared a supported protocolVersion). protocolVersion and
 * clientCapabilities are required; clientInfo is only a SHOULD; logLevel, when
 * present, must be an RFC 5424 severity. Malformed => -32602 (HTTP 400).
 */
export function validateModernMeta(params: unknown): ModernError | null {
  const meta = metaOf(params);
  if (!meta || typeof meta[MODERN_PROTOCOL_VERSION_META_KEY] !== 'string') {
    return { code: ERR_INVALID_PARAMS, message: `Invalid params: _meta["${MODERN_PROTOCOL_VERSION_META_KEY}"] is required` };
  }
  const caps = meta[META_CLIENT_CAPABILITIES];
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return { code: ERR_INVALID_PARAMS, message: `Invalid params: _meta["${META_CLIENT_CAPABILITIES}"] is required and must be an object` };
  }
  const level = meta[META_LOG_LEVEL];
  if (level !== undefined && !isValidLogLevel(level)) {
    return { code: ERR_INVALID_PARAMS, message: `Invalid params: _meta["${META_LOG_LEVEL}"] must be one of the RFC 5424 severities` };
  }
  return null;
}

/** The per-request log level, or undefined. Only meaningful after validateModernMeta passed. */
export function requestedLogLevel(params: unknown): McpLogLevel | undefined {
  const level = metaOf(params)?.[META_LOG_LEVEL];
  return isValidLogLevel(level) ? level : undefined;
}

/**
 * Streamable HTTP §Request Metadata: a Modern request MUST mirror its method
 * into Mcp-Method (and tools/call's params.name into Mcp-Name), and an
 * MCP-Protocol-Version header, when sent, MUST equal the _meta version.
 * Mirrors demo_mcp_gateway's GatewayServer check. Returns a message, or null.
 */
export function checkModernHeaders(
  headers: Record<string, string | string[] | undefined>,
  rpc: { method?: unknown; params?: unknown },
): string | null {
  const one = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const method = typeof rpc.method === 'string' ? rpc.method : undefined;
  const methodHeader = one('mcp-method');
  if (!methodHeader) return 'Missing required header: Mcp-Method';
  if (methodHeader !== method) {
    return `Header mismatch: Mcp-Method header value '${methodHeader}' does not match body value '${method}'`;
  }
  if (method === 'tools/call') {
    const p = rpc.params as { name?: unknown } | undefined;
    const bodyName = typeof p?.name === 'string' ? p.name : undefined;
    const nameHeader = one('mcp-name');
    if (!nameHeader) return 'Missing required header: Mcp-Name';
    if (nameHeader !== bodyName) {
      return `Header mismatch: Mcp-Name header value '${nameHeader}' does not match body value '${bodyName}'`;
    }
  }
  const protoHeader = one('mcp-protocol-version');
  const metaVersion = metaOf(rpc.params)?.[MODERN_PROTOCOL_VERSION_META_KEY];
  if (protoHeader !== undefined && protoHeader !== metaVersion) {
    return `Header mismatch: MCP-Protocol-Version header value '${protoHeader}' does not match _meta value '${String(metaVersion)}'`;
  }
  return null;
}

export type CacheScope = 'public' | 'private';
export interface CacheHints {
  ttlMs: number;
  cacheScope: CacheScope;
}

/**
 * Caching hints (caching.md "Cacheable Results"): required on complete results
 * of these methods. 'private' wherever the answer depends on the caller's
 * token (scope-filtered lists, reads); 'public' only for caller-independent
 * answers. resources/read is never reusable across calls here (live data).
 */
export const CACHE_HINTS: Readonly<Record<string, CacheHints>> = {
  'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
  'prompts/list': { ttlMs: 3_600_000, cacheScope: 'public' },
  'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
  'resources/list': { ttlMs: 60_000, cacheScope: 'private' },
  'resources/templates/list': { ttlMs: 60_000, cacheScope: 'private' },
  'resources/read': { ttlMs: 0, cacheScope: 'private' },
};

export interface ServerInfo {
  name: string;
  version: string;
}

/**
 * Wrap a transport `send` so every successful JSON-RPC result for a Modern
 * request carries resultType: 'complete' (required on all results), the
 * serverInfo _meta key (SHOULD), and — for the cacheable methods — ttlMs and
 * cacheScope. Errors and notifications pass through untouched, as do replies
 * that already declared a resultType (e.g. server/discover builds its own).
 */
export function decorateModernSend(
  method: string,
  serverInfo: ServerInfo,
  send: (s: string) => void,
): (s: string) => void {
  return (s: string): void => {
    let parsed: { result?: unknown; error?: unknown; id?: unknown };
    try { parsed = JSON.parse(s); } catch { send(s); return; }
    if (!parsed || typeof parsed !== 'object' || parsed.error !== undefined
        || !parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)) {
      send(s);
      return;
    }
    const result = parsed.result as Record<string, unknown>;
    const hints = CACHE_HINTS[method];
    const prevMeta = result._meta && typeof result._meta === 'object' ? (result._meta as Record<string, unknown>) : {};
    parsed.result = {
      resultType: 'complete',
      ...result,
      ...(hints && result.ttlMs === undefined ? hints : {}),
      _meta: { [META_SERVER_INFO]: serverInfo, ...prevMeta },
    };
    send(JSON.stringify(parsed));
  };
}
