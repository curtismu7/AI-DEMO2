// Maps an "inspect" type ("user" | "agent" | "mcp" — the same vocabulary
// TraceStepCard's d.inspectToken and TraceTokenSummary's meta.inspect use) to
// its real claims from this run's token events, so ClaimDetailsModal can show
// live values instead of always falling back to canned examples.
// Prefer 1-exchange ids; fall back to 2-exchange equivalents when present.
const INSPECT_TOKEN_EVENT_IDS = {
  user: ["user-token"],
  agent: ["agent-actor-token", "two-ex-agent-actor"],
  mcp: ["exchanged-token", "two-ex-final-token", "exchanged-token-fallback"],
};

export function resolveInspectClaims(tokenEvents, inspectType) {
  const ids = INSPECT_TOKEN_EVENT_IDS[inspectType];
  if (!ids) return null;
  const evt = (tokenEvents || []).find((e) => e && ids.includes(e.id));
  return evt?.claims || null;
}
