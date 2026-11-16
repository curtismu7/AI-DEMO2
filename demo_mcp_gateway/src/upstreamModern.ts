'use strict';

/**
 * MCP spec 2026-07-28 on the gateway's UPSTREAM hops.
 *
 * Toward a backend that speaks 2026-07-28 the gateway can drop the
 * initialize + notifications/initialized round trips and send each request
 * self-contained (params._meta plus Mcp-Method / Mcp-Name headers). This
 * module holds the decision and the pure transforms; proxy.ts (WS and HTTP
 * proxies) and GatewayServer.forwardToUpstream apply them.
 *
 * Opt-in: GW_UPSTREAM_MODERN=1. With it unset nothing here touches the
 * network and every hop behaves exactly as before.
 *
 * Safety net: whether a backend is Modern is learned from its own
 * server/discover reply (cached for the reply's public ttlMs; a Legacy or
 * unreachable backend is re-probed only every NEGATIVE_TTL_MS). If a backend
 * that advertised 2026-07-28 then rejects a Modern request before running it
 * (-32022 / -32020 / bad _meta), it is marked Legacy and the call is retried
 * once with the handshake.
 */

import axios from 'axios';

export const MODERN_VERSION = '2026-07-28';

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_INFO = 'io.modelcontextprotocol/clientInfo';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const PROBE_TIMEOUT_MS = 3_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const DEFAULT_POSITIVE_TTL_MS = 60_000;
const MAX_POSITIVE_TTL_MS = 60 * 60_000;

export function upstreamModernEnabled(): boolean {
  const v = (process.env.GW_UPSTREAM_MODERN || '').toLowerCase();
  return v === '1' || v === 'true';
}

interface CacheEntry {
  modern: boolean;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<boolean>>();

/** Test hook: forget everything learned about backends. */
export function resetUpstreamModernCache(): void {
  cache.clear();
  inFlight.clear();
}

/** A WebSocket backend URL's HTTP twin (the backends serve both on one port). */
export function wsToHttpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
}

/**
 * Does the backend at `baseUrl` speak 2026-07-28? Asks server/discover once
 * and caches the answer. Never throws: any failure means "not known to be
 * Modern" and is not cached for long, so a backend that comes up later is
 * noticed.
 */
export async function upstreamSupportsModern(baseUrl: string, bearer: string): Promise<boolean> {
  const key = baseUrl.replace(/\/+$/, '');
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.modern;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const probe = (async (): Promise<boolean> => {
    try {
      const resp = await axios.post(
        `${key}/mcp`,
        JSON.stringify({ jsonrpc: '2.0', id: 'gw-discover', method: 'server/discover', params: {} }),
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${bearer}`,
          },
          timeout: PROBE_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      const result = (resp.data as { result?: { supportedVersions?: unknown; ttlMs?: unknown } } | undefined)?.result;
      const modern = resp.status === 200
        && Array.isArray(result?.supportedVersions)
        && (result!.supportedVersions as unknown[]).includes(MODERN_VERSION);
      // An auth failure says nothing about the backend's protocol — don't cache it.
      if (resp.status === 401 || resp.status === 403) return false;
      const ttl = modern && typeof result?.ttlMs === 'number' && result.ttlMs > 0
        ? Math.min(result.ttlMs, MAX_POSITIVE_TTL_MS)
        : modern ? DEFAULT_POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      cache.set(key, { modern, expiresAt: Date.now() + ttl });
      return modern;
    } catch {
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, probe);
  return probe;
}

/** A backend that rejected a Modern request: treat as Legacy for a while. */
export function markUpstreamLegacy(baseUrl: string): void {
  cache.set(baseUrl.replace(/\/+$/, ''), { modern: false, expiresAt: Date.now() + NEGATIVE_TTL_MS });
}

/**
 * Did the backend refuse the request as Modern-malformed or unsupported
 * BEFORE running it? Only these are safe to retry over the Legacy handshake;
 * any other error (a tool failure, scope denial...) is the answer.
 */
export function isModernRejection(error: { code?: unknown; message?: unknown } | undefined): boolean {
  if (!error || typeof error.code !== 'number') return false;
  if (error.code === -32022 || error.code === -32020) return true;
  return error.code === -32602 && typeof error.message === 'string' && error.message.includes('_meta');
}

type Meta = Record<string, unknown>;

/** Is this request already Modern (the caller declared 2026-07-28 in _meta)? */
export function isModernCaller(params: unknown): boolean {
  const meta = (params as { _meta?: Meta } | undefined)?._meta;
  return !!meta && typeof meta === 'object' && meta[META_VERSION] === MODERN_VERSION;
}

/**
 * Make a JSON-RPC request self-contained for a Modern backend. Existing
 * _meta (progressToken, a Modern caller's own capabilities / clientInfo) is
 * kept; the gateway fills in only what is missing.
 */
export function toModernRequest<T extends { params?: unknown }>(request: T): T {
  const params = (request.params && typeof request.params === 'object' ? request.params : {}) as Record<string, unknown>;
  const inMeta = (params._meta && typeof params._meta === 'object' ? params._meta : {}) as Meta;
  return {
    ...request,
    params: {
      ...params,
      _meta: {
        ...inMeta,
        [META_VERSION]: MODERN_VERSION,
        [META_CAPS]: inMeta[META_CAPS] ?? {},
        [META_INFO]: inMeta[META_INFO] ?? { name: 'banking-mcp-gateway', version: '1.0.0' },
      },
    },
  };
}

/** Mcp-Method / Mcp-Name routing headers (Streamable HTTP §Request Metadata). */
export function modernRoutingHeaders(method: string | undefined, params: unknown): Record<string, string> {
  const headers: Record<string, string> = { 'MCP-Protocol-Version': MODERN_VERSION };
  if (method) headers['Mcp-Method'] = method;
  const name = (params as { name?: unknown } | undefined)?.name;
  if (method === 'tools/call' && typeof name === 'string') headers['Mcp-Name'] = name;
  return headers;
}

/**
 * A Legacy caller must see exactly what a Legacy backend would have sent:
 * drop the Modern-only result decoration (resultType, ttlMs, cacheScope and
 * the serverInfo _meta key) from a successful JSON-RPC reply.
 */
export function stripModernDecoration<T>(response: T): T {
  const r = response as unknown as { result?: Record<string, unknown> };
  if (!r || typeof r !== 'object' || !r.result || typeof r.result !== 'object' || Array.isArray(r.result)) return response;
  const { resultType: _rt, ttlMs: _ttl, cacheScope: _cs, _meta, ...rest } = r.result as Record<string, unknown>;
  void _rt; void _ttl; void _cs;
  let keptMeta: Record<string, unknown> | undefined;
  if (_meta && typeof _meta === 'object') {
    const { [META_SERVER_INFO]: _si, ...metaRest } = _meta as Record<string, unknown>;
    void _si;
    if (Object.keys(metaRest).length > 0) keptMeta = metaRest;
  }
  return { ...(response as object), result: { ...rest, ...(keptMeta ? { _meta: keptMeta } : {}) } } as T;
}

/**
 * What a Modern caller is owed on a successful result, whatever era the
 * backend is: resultType (a Legacy backend omits it). On tools/list the
 * gateway's own answer is per-caller — it filters the catalogue by the
 * caller's token — so it is cacheScope 'private' even if a backend said
 * 'public', and carries ttlMs (0 = not reusable) when the backend sent none.
 * An input_required result is interim and carries no caching hints.
 */
export function finalizeModernBody(body: Buffer, contentType: string, method: string | undefined): Buffer {
  if (!/application\/json/i.test(contentType)) return body;
  try {
    const parsed = JSON.parse(body.toString('utf-8')) as { result?: Record<string, unknown> };
    const r = parsed?.result;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return body;
    const next: Record<string, unknown> = { resultType: 'complete', ...r };
    if (method === 'tools/list' && next.resultType === 'complete') {
      next.cacheScope = 'private';
      if (typeof next.ttlMs !== 'number') next.ttlMs = 0;
    }
    return Buffer.from(JSON.stringify({ ...parsed, result: next }));
  } catch {
    return body;
  }
}

/** stripModernDecoration for a raw HTTP body; non-JSON bodies pass through untouched. */
export function stripModernDecorationFromBody(body: Buffer, contentType: string): Buffer {
  if (!/application\/json/i.test(contentType)) return body;
  try {
    return Buffer.from(JSON.stringify(stripModernDecoration(JSON.parse(body.toString('utf-8')))));
  } catch {
    return body;
  }
}
