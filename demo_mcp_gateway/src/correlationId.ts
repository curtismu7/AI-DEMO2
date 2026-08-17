import { randomUUID } from 'crypto';

/**
 * Resolve the correlation id for an inbound request.
 *
 * Precedence: X-Correlation-ID header → params.correlationId → fresh UUID.
 *
 * The JSON-RPC `id` is deliberately NOT a source. It is a per-connection
 * request counter, not a correlation: the BFF's WebSocket client uses a
 * hardcoded id (1 for initialize, 2 for the follow-up call) on EVERY request,
 * so treating it as a correlation collapsed every WS tool call ever made into
 * a single ledger transaction keyed "2" — hundreds of unrelated decisions,
 * across different users and sessions, merged into one record. A fresh UUID is
 * strictly better: an un-correlated hop is honest about being un-correlated,
 * whereas a colliding one silently corrupts every transaction it lands in.
 */
export function extractCorrelationId(
  headers: Record<string, unknown> | undefined,
  rpcMessage: { id?: unknown; params?: { correlationId?: unknown } } | undefined,
): string {
  const h = headers || {};
  const hdr = h['x-correlation-id'] ?? h['X-Correlation-ID'];
  if (typeof hdr === 'string' && hdr) return hdr;
  const p = rpcMessage?.params?.correlationId;
  if (typeof p === 'string' && p) return p;
  return randomUUID();
}
