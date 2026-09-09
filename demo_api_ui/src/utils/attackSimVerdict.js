/**
 * Verdict for an attack-sim (or intent-binding) result body.
 *
 *   PERMIT — 2xx: the control did not fire.
 *   DENY   — the security tier: 401/403/428/429, or the 503 an armed
 *            introspection outage fails closed with.
 *   ERROR  — everything else. A sim that died at token exchange
 *            (502 exchange_failed), config (503 gateway_not_configured,
 *            502 gateway_push_failed, 500 config_store_failed) or the route
 *            (500 sim_execution_failed) proved nothing. It used to render as
 *            "502 DENY" — an outage read as a successful defence
 *            (tests/real/shared/attack-sims-live.test.js records the same
 *            hole on the server side).
 *
 * @param {{ status?: unknown, errorCode?: string, error?: string } | null | undefined} data
 * @returns {'PERMIT' | 'DENY' | 'ERROR'}
 */
const DENY_STATUSES = new Set([401, 403, 428, 429, 503]);
const INFRA_CODES = new Set([
  'gateway_not_configured',
  'gateway_push_failed',
  'exchange_failed',
  'config_store_failed',
  'sim_execution_failed',
  'sim_not_applicable',
  'GATEWAY_UNREACHABLE',
]);

export function attackSimVerdict(data) {
  const status = data?.status;
  if (typeof status !== 'number') return 'ERROR';
  if (status < 400) return 'PERMIT';
  if (INFRA_CODES.has(data?.errorCode || data?.error)) return 'ERROR';
  return DENY_STATUSES.has(status) ? 'DENY' : 'ERROR';
}

/** One-line suffix for the chat bubble; empty for PERMIT/DENY. */
export function attackSimVerdictNote(verdict) {
  return verdict === 'ERROR' ? '(sim could not run — no control was tested)' : '';
}
