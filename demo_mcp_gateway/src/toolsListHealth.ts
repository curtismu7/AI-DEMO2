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
