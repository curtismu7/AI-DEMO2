import { randomUUID } from 'crypto';

export function extractCorrelationId(
  headers: Record<string, unknown> | undefined,
  rpcMessage: { id?: unknown; params?: { correlationId?: unknown } } | undefined,
): string {
  const h = headers || {};
  const hdr = h['x-correlation-id'] ?? h['X-Correlation-ID'];
  if (typeof hdr === 'string' && hdr) return hdr;
  const p = rpcMessage?.params?.correlationId;
  if (typeof p === 'string' && p) return p;
  const id = rpcMessage?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return randomUUID();
}
