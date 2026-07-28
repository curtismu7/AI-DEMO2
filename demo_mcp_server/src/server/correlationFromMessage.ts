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
 * Precedence: explicit RPC param → inbound HTTP header → JSON-RPC id → fresh UUID.
 *
 * The header leg is what makes BFF → gateway → mcp-server correlation survive
 * over HTTP: the gateway stamps X-Correlation-ID on every proxied call, but
 * only some call sites also inject params.correlationId. The JSON-RPC id ranks
 * BELOW the header because it is a per-connection counter, not a correlation.
 */
export function correlationFromMessage(msg: RpcLike | undefined, headers?: HeaderBag): string {
  const p = msg?.params?.correlationId;
  if (typeof p === 'string' && p) return p;

  const fromHeader =
    headerValue(headers, 'x-correlation-id') ?? headerValue(headers, 'x-request-id');
  if (fromHeader) return fromHeader;

  const id = msg?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return randomUUID();
}
