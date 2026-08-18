'use strict';

/**
 * toolsListHealth.ts — visibility for a tools/list backend outage.
 *
 * When a backend's tools/list fails, the gateway still answers with whatever it
 * did read plus its own static gateway-owned list, so the response looks healthy
 * and that backend's live catalog is silently absent. The fallback itself is
 * deliberate (partial results beat no results); what was missing is any signal
 * that it happened. This module holds that signal for GET /health and
 * rate-limits the accompanying log line so it stays readable under a per-second
 * caller.
 *
 * PARTIAL outages count. This originally recorded only the TOTAL case, and
 * anything less called clearToolsListBackendOutage() — so a single backend
 * timing out reported `toolsListBackendOutage: null`, i.e. healthy. Observed
 * live: `olb` failed its tools/list repeatedly while every other backend
 * answered, its tools vanished from the catalog, and /health said nothing was
 * wrong. An agent then sees a short tool list and reports "tool not found"
 * instead of "backend down". The per-backend console.warn does exist, but as the
 * call site notes, those "scroll past unnoticed at this rate" — which is exactly
 * what a health endpoint is for.
 */

export type ToolsListOutageScope = 'total' | 'partial';

interface ToolsListOutage {
  /** 'total' = zero live backends read; 'partial' = some answered, some did not. */
  scope: ToolsListOutageScope;
  /** Backends that failed on the most recent tools/list. */
  backends: string[];
  since: string;
  lastSeen: string;
  occurrences: number;
}

const LOG_INTERVAL_MS = 60_000;

let _outage: ToolsListOutage | null = null;
let _lastLoggedAt = 0;

/**
 * Record that one or more backends failed tools/list; logs at most once per
 * minute. Pass the failed backends and how many were attempted so a total
 * outage stays distinguishable from a partial one.
 */
export function recordToolsListBackendOutage(backends: string[], attempted?: number): void {
  if (!backends.length) {
    clearToolsListBackendOutage();
    return;
  }
  const scope: ToolsListOutageScope =
    typeof attempted === 'number' && attempted > 0 && backends.length >= attempted
      ? 'total'
      : 'partial';
  const now = new Date().toISOString();

  // A change of scope or of which backends are down starts a new episode —
  // otherwise "since" would describe a different failure than the one current.
  const sameEpisode = _outage
    && _outage.scope === scope
    && _outage.backends.join(',') === backends.join(',');

  _outage = sameEpisode && _outage
    ? { ..._outage, lastSeen: now, occurrences: _outage.occurrences + 1 }
    : { scope, backends, since: now, lastSeen: now, occurrences: 1 };
  if (!sameEpisode) _lastLoggedAt = 0;

  if (Date.now() - _lastLoggedAt >= LOG_INTERVAL_MS) {
    _lastLoggedAt = Date.now();
    const detail = `${_outage.occurrences} time(s) since ${_outage.since}`;
    if (scope === 'total') {
      console.error(
        `[GW] ⚠️  tools/list read ZERO live backends (${backends.join(', ')} all failed) — ` +
        `serving the static gateway-owned registry only. ${detail}.`,
      );
    } else {
      console.error(
        `[GW] ⚠️  tools/list backend(s) DOWN: ${backends.join(', ')} — their tools are ` +
        `missing from the catalog and callers will see "tool not found", not an outage. ${detail}.`,
      );
    }
  }
}

/** Clear the outage after every backend answers again. */
export function clearToolsListBackendOutage(): void {
  _outage = null;
  _lastLoggedAt = 0;
}

/** Outage summary for GET /health, or null when the last tools/list read every backend. */
export function toolsListBackendOutage(): ToolsListOutage | null {
  return _outage;
}

/**
 * Fields proxy.ts attaches to a handshake-timeout rejection (see the enriched
 * reject in proxyJsonRpc). Read structurally here so the fan-out can log them.
 */
interface HandshakeTimeoutReason {
  code?: string;
  message?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  connectMs?: number | null;
}

/**
 * Structured, greppable one-liner for a single backend's tools/list failure,
 * emitted by the fan-out in index.ts. For a handshake timeout it surfaces the
 * configured timeout, the elapsed-to-failure, and the connect latency captured
 * in proxy.ts — the data TECH_DEBT (2026-08-18, `olb` handshake timeout) asked
 * for to correlate the timeout with mcp-server restarts or cold starts.
 *
 * It reports `pool=none(fresh-ws-per-request)` deliberately: the proxy opens a
 * fresh WebSocket per request, so connection-pool exhaustion (the TECH_DEBT note
 * cited `MCP_WS_MAX_CONCURRENT`, which does not exist in this codebase) is ruled
 * out as the mechanism by construction — one less hypothesis to chase next time.
 * `attempts=1` reflects that the fan-out makes a single handshake attempt (no
 * retry); the field is present so the number is legible if a retry is ever added.
 *
 * Keeps the `tools/list failed for backend=<id>` prefix that TECH_DEBT documents
 * as the symptom so an operator grepping that string still gets a hit — now with
 * the diagnostics appended. Only ever called on the failure path.
 */
export function formatToolsListBackendFailure(backend: string, reason: unknown): string {
  const base = `[GW] tools/list failed for backend=${backend}`;
  const e = reason as HandshakeTimeoutReason | undefined;
  if (e && e.code === 'handshake_timeout') {
    const connect = e.connectMs == null ? 'n/a' : String(e.connectMs);
    return (
      `${base} reason=handshake_timeout timeoutMs=${e.timeoutMs} ` +
      `elapsedMs=${e.elapsedMs} connectMs=${connect} attempts=1 ` +
      `pool=none(fresh-ws-per-request)`
    );
  }
  const msg = reason instanceof Error ? reason.message : String(reason);
  return `${base} reason=other attempts=1 message=${JSON.stringify(msg)}`;
}
