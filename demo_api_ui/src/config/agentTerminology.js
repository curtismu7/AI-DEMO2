/**
 * Shared user-facing terminology for the agent experience.
 *
 * These values describe presentation only. Runtime IDs, PingOne client names,
 * OAuth audiences, and credential/configuration keys remain unchanged.
 */

export const PRIMARY_AGENT = Object.freeze({
  key: "banking-agent",
  displayName: "Banking Agent",
});

export const AGENT_ROLES = Object.freeze({
  generalist: "Generalist agent",
  planner: "Planner",
  specialist: "Specialist agent",
});

export const RUN_PROVENANCE = Object.freeze({
  mock: "Mock replay",
  recorded: "Recorded run",
  live: "Live run",
});

export const EVIDENCE_FRAME_LABELS = Object.freeze([
  "User prompt",
  "Agent route",
  "Token exchange",
  "Authorize",
  "Tool call",
  "Agent reply",
]);

const TRACE_EVENT_LABELS = Object.freeze({
  "a2a-agent1-actor": `${PRIMARY_AGENT.displayName} · ${AGENT_ROLES.generalist} actor`,
  "a2a-exchange1": `Exchange #1 · user + ${AGENT_ROLES.generalist}`,
  "a2a-agent2-actor": `${AGENT_ROLES.specialist} actor`,
  "a2a-exchange2": "Exchange #2 · nested specialist delegation",
  "agent-actor-token": `${PRIMARY_AGENT.displayName} identity token`,
  "two-ex-agent-actor": `${PRIMARY_AGENT.displayName} identity token`,
});

/**
 * Put the friendly identity first and technical runtime metadata second.
 * Empty values are omitted so identity cards can use the same helper for
 * live PingOne rows and static runtime choices.
 */
export function formatAgentLabel(displayName, runtimeId) {
  const name = displayName?.trim() || PRIMARY_AGENT.displayName;
  const runtime = runtimeId?.trim();
  return runtime ? `${name} · ${runtime}` : name;
}

/** Normalize labels for compact trace surfaces without changing event IDs. */
export function formatTraceEventLabel(event) {
  if (!event) return "Step";
  return TRACE_EVENT_LABELS[event.id] || event.label || event.id || "Step";
}
