import { getCorrelationId } from './correlationContext';

const SERVICE = 'mcp-gateway';

export interface TransactionHopInput {
  phase:
    | 'ui.request' | 'agent.reason' | 'token.exchange' | 'gateway.authorize'
    | 'authz.decision' | 'hitl.consent' | 'mcp.tool' | 'response';
  op?: string;
  identity?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  details?: Record<string, unknown>;
  durationMs?: number;
  status?: 'ok' | 'error';
  correlationId?: string;
  params?: Record<string, unknown>;
  consentRequired?: boolean;
  vertical?: string;
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
 */
export function emitHop(hop: TransactionHopInput): void {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId ?? getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}
