// Replay a run that happened with nobody watching into the Token Chain rail.
//
// The rail is normally fed live over SSE while a browser drives a run, so a
// 02:00 scheduled job can never appear there as it happens. Its token events
// are stored by the BFF instead, and this hands them to the same store the live
// path uses — the same approach simTraceAdapter takes for attack-sim runs.
//
// No new rendering path: the events already carry rail-recognized ids, so
// buildTraceSteps and deriveAgentClass treat a replayed run exactly like a live
// one. That is what makes the Autonomous badge light up for it.

import { tokenChainTraceStore } from "./tokenChainTraceStore";

/**
 * Replay a stored run's token events into the Token Chain rail. Shared by the
 * unattended-runs panel (AutonomousAgentsPage) and the run-history inspector
 * (AgentFlowHistoryPage) — same store, same derivation, so a replayed run
 * renders exactly like a live one.
 *
 * @param {object} run - a stored run record carrying tokenEvents
 * @param {{ prompt?: string, ok?: boolean }} [opts] - the rail's origin line
 *   and completion state; each caller supplies what its records carry.
 * @returns {boolean} false when the run carries nothing to replay
 */
export function replayRunIntoTrace(run, { prompt, ok } = {}) {
  const events = run && Array.isArray(run.tokenEvents) ? run.tokenEvents : [];
  if (!events.length) return false;

  // reset() first, and this is load-bearing rather than tidiness. beginTrace()
  // and ingestTokenEvents() both carry SESSION_EVENT_IDS — "user-token" among
  // them — forward from the previous trace, so replaying while signed in would
  // splice the viewer's own user token into the replayed run. deriveAgentClass
  // would then see a user token, call it a Worker, and the badge would be wrong
  // in precisely the case this whole path exists to show. reset() empties the
  // trace so there is nothing to carry.
  tokenChainTraceStore.reset();

  tokenChainTraceStore.beginTrace({
    prompt: prompt || "Replayed run",
    provenance: "recorded",
  });
  tokenChainTraceStore.ingestTokenEvents(events);
  tokenChainTraceStore.completeTrace(ok !== false);

  return true;
}

/**
 * @param {object} run - a run from GET /api/autonomous-runs/:runId
 * @returns {boolean} false when the run carries nothing to replay
 */
export function replayUnattendedRun(run) {
  return replayRunIntoTrace(run, {
    prompt: `${run?.job || "scheduled job"} — ${run?.trigger || "unattended"} (no user present)`,
    ok: run ? run.status !== "failed" : undefined,
  });
}

/** Short human summary for a run row. */
export function describeRun(run) {
  if (!run) return "";
  if (run.status === "failed") return `failed — ${run.error || "unknown error"}`;
  const n = Array.isArray(run.findings) ? run.findings.length : 0;
  const scanned = run.scanned || 0;
  if (!n) return `no findings across ${scanned} transaction${scanned === 1 ? "" : "s"}`;
  return `${n} finding${n === 1 ? "" : "s"} across ${scanned} transaction${scanned === 1 ? "" : "s"}`;
}
