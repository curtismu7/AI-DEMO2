const SERVICE = 'mcp-resource-server';

export interface TransactionHopInput {
  phase: 'mcp.tool';
  op?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  correlationId: string;
}

type FetchLike = (url: string, init: any) => Promise<any>;
let _fetch: FetchLike | undefined;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  _fetch = fn;
}

/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 * Never awaited and never throws — auditing must never break the tool-call path.
 * Mirrors demo_mcp_gateway/src/transactionHop.ts; no AsyncLocalStorage here since
 * this server has a single call site and the correlation id is already in hand
 * (forwarded by the gateway in msg.params.correlationId).
 */
export function emitHop(hop: TransactionHopInput): void {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    if (!hop.correlationId) return;

    const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}
