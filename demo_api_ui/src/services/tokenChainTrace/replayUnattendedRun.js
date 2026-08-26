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
 * @param {object} run - a run from GET /api/autonomous-runs/:runId
 * @returns {boolean} false when the run carries nothing to replay
 */
export function replayUnattendedRun(run) {
  const events = run && Array.isArray(run.tokenEvents) ? run.tokenEvents : [];
  if (!events.length) return false;

  const findings = Array.isArray(run.findings) ? run.findings.length : 0;

  // reset() first, and this is load-bearing rather than tidiness. beginTrace()
  // and ingestTokenEvents() both carry SESSION_EVENT_IDS — "user-token" among
  // them — forward from the previous trace, so replaying while signed in would
  // splice the viewer's own user token into an unattended run. deriveAgentClass
  // would then see a user token, call it a Worker, and the badge would be wrong
  // in precisely the case this whole path exists to show. reset() empties the
  // trace so there is nothing to carry.
  tokenChainTraceStore.reset();

  // The prompt line is what the rail shows as the run's origin. An unattended
  // run has no prompt because nobody typed one — say what fired it instead.
  tokenChainTraceStore.beginTrace({
    prompt: `${run.job || "scheduled job"} — ${run.trigger || "unattended"} (no user present)`,
  });
  tokenChainTraceStore.ingestTokenEvents(events);
  tokenChainTraceStore.completeTrace(run.status !== "failed");

  return true;
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
