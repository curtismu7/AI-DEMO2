'use strict';

/**
 * toolsListHealth.ts — visibility for a TOTAL tools/list backend outage.
 *
 * When every backend's tools/list fails, the gateway still answers with its own
 * static gateway-owned tool list, so the response looks healthy and the live
 * backend catalog is silently never read. The fallback itself is deliberate
 * (partial results beat no results); what was missing is any signal that it
 * happened. This module holds that signal for GET /health and rate-limits the
 * accompanying log line so it stays readable under a per-second caller.
 */

interface ToolsListOutage {
  backends: string[];
  since: string;
  lastSeen: string;
  occurrences: number;
}

const LOG_INTERVAL_MS = 60_000;

let _outage: ToolsListOutage | null = null;
let _lastLoggedAt = 0;

/** Record that EVERY backend failed tools/list; logs at most once per minute. */
export function recordToolsListBackendOutage(backends: string[]): void {
  const now = new Date().toISOString();
  _outage = _outage
    ? { ..._outage, backends, lastSeen: now, occurrences: _outage.occurrences + 1 }
    : { backends, since: now, lastSeen: now, occurrences: 1 };

  if (Date.now() - _lastLoggedAt >= LOG_INTERVAL_MS) {
    _lastLoggedAt = Date.now();
    console.error(
      `[GW] ⚠️  tools/list read ZERO live backends (${backends.join(', ')} all failed) — ` +
      `serving the static gateway-owned registry only. ${_outage.occurrences} time(s) since ${_outage.since}.`,
    );
  }
}

/** Clear the outage after any backend answers again. */
export function clearToolsListBackendOutage(): void {
  _outage = null;
  _lastLoggedAt = 0;
}

/** Outage summary for GET /health, or null when the last tools/list read a backend. */
export function toolsListBackendOutage(): ToolsListOutage | null {
  return _outage;
}
