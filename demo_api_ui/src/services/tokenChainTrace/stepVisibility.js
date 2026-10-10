// demo_api_ui/src/services/tokenChainTrace/stepVisibility.js
//
// THE one step-visibility policy. Every step-box surface (token-chain rail,
// node rail, movie reel, filmstrip, topology canvas, MCP tab) asks this module
// which hops a run actually performed, instead of each keeping its own filter.
// Four ad-hoc filters had drifted (rail live projection, reel HAPPENED set,
// topology UNFIRED_STATUSES, filmstrip's import of the rail's projection);
// this module replaces all four.
//
// Policy (approved 2026-10-09): show what happened; on a COMPLETED run, the
// hops that never fired collapse behind a "+N hops not in this run" chip the
// consumer renders; expanding them reveals them greyed with a reason. In
// flight, unfired hops are simply hidden — mid-run there is nothing to teach
// about a hop the run may still reach.
//
// buildTraceSteps output is consumed as-is: statuses are never rewritten here
// (no new status strings — see buildTraceSteps.js's notRequired comment).

// A step only counts as "happened" in these statuses. "waiting" is included
// because the reel already treated it as happened (an exchange paused on a
// gate is very much part of the run).
export const HAPPENED_STATUSES = ["done", "active", "error", "waiting"];

// Moved verbatim from TokenChainTraceRail.jsx (SKIPPED_STEP_REASONS). Keyed by
// baseId — multi-decision authorize steps (authorize:2, authorize:3) collapse
// under the base id's reason.
export const SKIP_REASONS = {
  signin: "No sign-in token evidence was recorded for this run.",
  agent: "The Banking Agent did not participate in this run.",
  llm: "No LLM reasoning was used on this run.",
  "agent-token": "No separate agent identity token was acquired.",
  exchange: "Token exchange was skipped; no delegated token was issued.",
  authorize: "PingOne Authorize was skipped; no policy decision was recorded.",
  stepup: "No step-up or human approval challenge was required.",
  "intent-binding": "No RAR intent-binding check was required.",
  gateway: "The Agent Gateway was not in this run's path.",
  "api-key-swap": "The run did not use the API-key credential-swap path.",
  mcp: "No MCP tool call occurred.",
  api: "No downstream resource-server call occurred.",
  database: "No SQL database access was observed for this run.",
  reply: "No final reply evidence was recorded.",
  "tools-list-challenge": "No anonymous discovery challenge was issued on this run (guest path, or no gateway in route).",
  "tools-call-challenge": "No anonymous tools/call challenge was issued on this run (guest path, or no gateway in route).",
  "a2a-agent1-actor": "The Banking Agent identity token was not observed.",
  "a2a-exchange1": "The user-to-generalist exchange was not observed.",
  "a2a-agent2-actor": "The specialist agent identity token was not observed.",
  "a2a-exchange2": "The nested specialist delegation exchange was not observed.",
  "a2a-agent-card": "Specialist Agent Card discovery was not observed.",
  "a2a-protocol-message": "The A2A SendMessage handoff was not observed.",
};

// Rows that exist before any run: the browser step is unconditionally done and
// beginTrace carries sign-in across runs. the module still returns empty for
// session-only state — these never trigger the chip.
function hasActivity(trace) {
  return Boolean(
    trace?.startedAt || trace?.prompt || trace?.tokenEvents?.length ||
    trace?.phases?.length || trace?.mcpResult || trace?.authorize ||
    trace?.llmDetail || trace?.llmReply || trace?.outcome || trace?.routingMode,
  );
}

function isComplete(trace) {
  return ["ok", "error", "mock-success"].includes(trace?.outcome);
}

function fired(step) {
  return HAPPENED_STATUSES.includes(step?.status) || step?.detail?.notRequired;
}

/**
 * @param {Array} steps  buildTraceSteps output (already spliced with A2A /
 *                       Privilege hops by the caller where that applies)
 * @param {object} trace the store trace
 * @param {{ collapsed?: boolean }} [opts] complete runs only: true hides the
 *                       non-fired hops (consumer renders the count chip);
 *                       false additionally returns them in `revealed`, each
 *                       annotated with its skip narrative.
 * @returns {{ visible: Array, skipped: Array, revealed: Array }}
 */
export function applyStepVisibility(steps, trace, { collapsed = true } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  if (!hasActivity(trace)) return { visible: [], skipped: [], revealed: [] };
  const visible = list.filter(fired);
  if (!isComplete(trace)) return { visible, skipped: [], revealed: [] };
  const skipped = list.filter((step) => !fired(step));
  const revealed = collapsed ? [] : skipped.map((step) => {
    if (trace.outcome === "mock-success") return step;
    const baseId = step.baseId || step.id;
    return {
      ...step,
      detail: {
        ...step.detail,
        narrative: SKIP_REASONS[baseId] || "This possible step was not observed in the completed run.",
      },
    };
  });
  return { visible, skipped, revealed };
}
