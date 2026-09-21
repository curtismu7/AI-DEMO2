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
