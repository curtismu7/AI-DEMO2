// Shared chip permission gating, used by both the regular chip rail (BankingChips)
// and the Security Showcase panel so the two surfaces can never diverge.
//
// Join a chip with the live Authorize-filtered tool list. No backing tool →
// always active. No perms yet: if the fetch ERRORED we can't verify → mark
// unverified (disabled, not a doomed click); if it's just still loading → show
// active briefly. Otherwise: tool absent from the list → hide (vertical-foreign);
// present but not permitted → grey (scope-denied) with the reason.
export function chipPermState(chip, toolPermissions = {}, toolsError = false) {
  const havePerms = toolPermissions && Object.keys(toolPermissions).length > 0;
  if (!chip.tool) return { show: true, denied: false };
  if (!havePerms) return toolsError ? { show: true, unverified: true } : { show: true, denied: false };
  const t = toolPermissions[chip.tool];
  if (!t) return { show: false, denied: false };
  return { show: true, denied: t.permitted === false, reason: t.deniedReason };
}
