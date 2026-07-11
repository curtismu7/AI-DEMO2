// Shared chip permission gating, used by both the regular chip rail (BankingChips)
// and the Security Showcase panel so the two surfaces can never diverge.
//
// Join a chip with the live Authorize-filtered tool list. Only an EXPLICIT
// Authorize deny (tool present with permitted:false) greys a chip. Everything
// the UI cannot verify — list still loading, fetch errored, or tool absent from
// the list (degraded/stale discovery) — renders ACTIVE and clickable: chips
// never vanish or lock up on discovery blips. This is safe because chip state
// is affordance only; every tools/call still goes through the gateway's
// per-call PingOne Authorize decision, which fails closed.
// (`toolsError` is kept in the signature for callers but no longer disables.)
export function chipPermState(chip, toolPermissions = {}, toolsError = false) {
  if (!chip.tool) return { show: true, denied: false };
  const t = toolPermissions ? toolPermissions[chip.tool] : null;
  if (t && t.permitted === false) return { show: true, denied: true, reason: t.deniedReason };
  return { show: true, denied: false };
}
