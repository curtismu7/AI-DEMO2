import { randomUUID } from 'crypto';

interface RpcLike {
  id?: unknown;
  params?: { correlationId?: unknown };
}

type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag | undefined, name: string): string | undefined {
  const raw = headers?.[name];
  return typeof raw === 'string' && raw ? raw : undefined;
}

/**
 * Resolve the correlation id for an inbound MCP message.
 *
 * Precedence: explicit RPC param → inbound HTTP header → fresh UUID.
 *
 * The header leg is what makes BFF → gateway → mcp-server correlation survive
 * over HTTP: the gateway stamps X-Correlation-ID on every proxied call, but
 * only some call sites also inject params.correlationId. The JSON-RPC id is
 * deliberately NOT consulted — it is a per-connection counter, not a
 * correlation, and the BFF's WS client reuses a hardcoded value on every call.
 */
export function correlationFromMessage(msg: RpcLike | undefined, headers?: HeaderBag): string {
  const p = msg?.params?.correlationId;
  if (typeof p === 'string' && p) return p;

  const fromHeader =
    headerValue(headers, 'x-correlation-id') ?? headerValue(headers, 'x-request-id');
  if (fromHeader) return fromHeader;

  // The JSON-RPC `id` is NOT a correlation source — see the note above. It is a
  // per-connection counter, and the BFF's WS client sends a hardcoded 1/2 on
  // every request, so using it merges unrelated transactions into one ledger
  // record. An un-correlated hop (fresh UUID) is honest; a colliding one is
  // corruption.
  return randomUUID();
}
