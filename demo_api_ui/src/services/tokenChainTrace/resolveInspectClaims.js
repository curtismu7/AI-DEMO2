// Maps an "inspect" type ("user" | "agent" | "mcp" — the same vocabulary
// TraceStepCard's d.inspectToken and TraceTokenSummary's meta.inspect use) to
// its real claims from this run's token events, so ClaimDetailsModal can show
// live values instead of always falling back to canned examples.
const INSPECT_TOKEN_EVENT_ID = {
  user: "user-token",
  agent: "agent-actor-token",
  mcp: "exchanged-token",
};

export function resolveInspectClaims(tokenEvents, inspectType) {
  const eventId = INSPECT_TOKEN_EVENT_ID[inspectType];
  if (!eventId) return null;
  const evt = (tokenEvents || []).find((e) => e && e.id === eventId);
  return evt?.claims || null;
}
