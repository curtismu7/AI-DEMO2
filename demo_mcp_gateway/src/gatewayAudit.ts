/**
 * gatewayAudit — durable, transport-agnostic MCP tool-call audit.
 *
 * The gateway is the single chokepoint that sees every tool call across all
 * verticals (incl. direct agent-service calls that bypass the BFF), but it is
 * stateless. Each tool-call outcome is shipped to the BFF's LMDB via the
 * secret-guarded /internal/mcp-audit ingest endpoint. Best-effort and
 * fire-and-forget: auditing must NEVER block or fail the request path.
 *
 * Both transports record through here so coverage is identical:
 *   - WebSocket tools/call  (index.ts handleMessage)        → auditOutcomeFromResponse
 *   - HTTP POST /mcp        (authorizeMcpRequest middleware) → auditOutcomeFromHttp
 */
import axios from 'axios';
import type { GatewayConfig } from './config';
import { getCorrelationId } from './correlationContext';
import { emitHop } from './transactionHop';

export interface GatewayAuditEvent {
  operation: string;          // tool name
  outcome: 'success' | 'failure' | 'partial';  // 'partial' = HITL approval pending
  agentId?: string;           // actor (act.sub)
  userId?: string;            // subject (sub)
  duration?: number;          // ms
  vertical?: string;          // routeTool target
  correlationId?: string;     // request id shared across BFF → gateway → authz
  details?: Record<string, unknown>;
}

// Derived from the configured id-token URL so it follows the BFF base in every
// environment without a new env var / k8s change. Returns null if the id-token
// URL is unset/unexpected — auditing then no-ops rather than throwing.
export function bffAuditUrl(config: GatewayConfig): string | null {
  const idUrl = config.bffInternalIdTokenUrl;
  if (typeof idUrl !== 'string' || !idUrl) return null;
  return idUrl.replace(/\/internal\/id-token$/, '/internal/mcp-audit');
}

// Maps a recorded audit outcome to a chain-of-custody decision for the
// emitted `gateway.authorize` hop. `auditOutcomeFromHttp` / `auditOutcomeFromResponse`
// bucket EVERY non-2xx, non-HITL response as 'failure' — that includes both
// genuine authorization denials (403 insufficient_scope / JSON-RPC -32005)
// and unrelated infrastructure failures (token-exchange 502s, backend 500s,
// timeouts). Only the former may report `deny`: INV-6 ("no mcp.tool hop may
// follow a deny decision for the same op") must never fire on a transient
// backend error that a retry then succeeds on. A scope denial is recognized
// by `details.alert === true && details.reason === 'insufficient_scope'` —
// the exact shape `buildScopeAlert` stamps via `scopeAlertDetails` (WS,
// JSON-RPC -32005) and `httpScopeAlertDetails` (HTTP 403 insufficient_scope).
export function decisionFromAuditOutcome(
  outcome: GatewayAuditEvent['outcome'],
  details?: Record<string, unknown>,
): { outcome: 'permit' | 'deny' | 'n/a'; reason: string } {
  if (outcome !== 'failure') {
    return { outcome: outcome === 'success' ? 'permit' : 'n/a', reason: outcome };
  }
  const isAuthzDenial = details?.alert === true && details?.reason === 'insufficient_scope';
  return {
    outcome: isAuthzDenial ? 'deny' : 'n/a',
    reason: isAuthzDenial ? 'failure:insufficient_scope' : 'failure:gateway_error',
  };
}

// Called synchronously from inside the WS send / HTTP res.end wrappers, so the
// whole body (URL derivation included) is wrapped: a throw here must NEVER
// propagate into the tool-call response path.
export function recordGatewayAudit(event: GatewayAuditEvent, config: GatewayConfig): void {
  try {
    const url = bffAuditUrl(config);
    if (!url) return;
    // Stamp the request's correlation id (shared across BFF → gateway → authz)
    // unless the caller already set one, so every audited tool-call outcome in
    // the BFF's LMDB is correlatable back to the originating request.
    const enriched: GatewayAuditEvent = event.correlationId
      ? event
      : { ...event, correlationId: getCorrelationId() };
    // Same chokepoint, second consumer: the durable audit trail keeps its
    // existing shape while the ledger gets a hop with identity fields on it.
    const decision = decisionFromAuditOutcome(enriched.outcome, enriched.details);
    emitHop({
      phase: 'gateway.authorize',
      op: enriched.operation,
      correlationId: enriched.correlationId,
      durationMs: enriched.duration,
      identity: { sub: enriched.userId ?? null, act: enriched.agentId ? [enriched.agentId] : [] },
      decision: {
        outcome: decision.outcome,
        by: 'gateway',
        reason: decision.reason,
      },
      status: enriched.outcome === 'failure' ? 'error' : 'ok',
    });
    axios
      .post(url, enriched, {
        headers: { 'x-internal-gateway-secret': config.bffInternalSecret },
        timeout: 2000,
        validateStatus: () => true,
      })
      .catch(() => { /* swallow — never affect the tool-call response */ });
  } catch {
    /* swallow — auditing must never break the request path */
  }
}

// WS path — classify a JSON-RPC response string. A -32002 error is the HITL
// "approval required" signal: a pending decision, not a failure.
export function auditOutcomeFromResponse(
  payload: string,
): { outcome: GatewayAuditEvent['outcome']; code?: number; data?: unknown } {
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.error) {
      const code = parsed.error.code;
      return { outcome: code === -32002 ? 'partial' : 'failure', code, data: parsed.error.data };
    }
    return { outcome: 'success' };
  } catch {
    return { outcome: 'success' };
  }
}

// Scenario 4 — flag an insufficient-scope denial as an audit ALERT so the
// compliance trail shows "agent attempted unauthorized tool" with the required
// vs. held scopes. The MCP server returns JSON-RPC -32005 (WS) /
// HTTP 403 insufficient_scope; both carry { tool, requiredScopes, missingScopes,
// availableScopes } (HTTP also uses required_scope). The two transport parsers
// normalize to these fields then share one builder so the alert shape can't
// drift between WS and HTTP.
function buildScopeAlert(f: { requiredScopes?: unknown; missingScopes?: unknown; availableScopes?: unknown; tool?: unknown }): Record<string, unknown> {
  return {
    alert: true,
    reason: 'insufficient_scope',
    requiredScopes: f.requiredScopes ?? [],
    missingScopes: f.missingScopes ?? [],
    availableScopes: f.availableScopes ?? [],
    ...(f.tool ? { tool: f.tool } : {}),
  };
}

// WS variant — JSON-RPC -32005 error.data. Returns null otherwise so the normal
// failure detail is left untouched.
export function scopeAlertDetails(code: number | undefined, data: unknown): Record<string, unknown> | null {
  if (code !== -32005 || !data || typeof data !== 'object') return null;
  return buildScopeAlert(data as Record<string, unknown>);
}

// HTTP variant — parse a 403 insufficient_scope body (HttpMCPTransport shape:
// { error:'insufficient_scope', required_scope, tool, ... }). Returns null
// unless this is a scope denial.
export function httpScopeAlertDetails(statusCode: number, bodyText: string): Record<string, unknown> | null {
  if (statusCode !== 403 || !/insufficient_scope/.test(bodyText)) return null;
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(bodyText) as Record<string, unknown>; } catch { /* keep best-effort */ }
  return buildScopeAlert({
    requiredScopes: b.required_scope ? [b.required_scope] : b.requiredScopes,
    missingScopes: b.missingScopes,
    availableScopes: b.availableScopes,
    tool: b.tool,
  });
}

// HTTP path — classify by status code, treating a HITL-required 403 (body
// carries hitl_required / hitl:true) as pending rather than a hard failure.
export function auditOutcomeFromHttp(
  statusCode: number,
  bodyText: string,
): GatewayAuditEvent['outcome'] {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (/hitl_required|"hitl"\s*:\s*true/i.test(bodyText)) return 'partial';
  return 'failure';
}
