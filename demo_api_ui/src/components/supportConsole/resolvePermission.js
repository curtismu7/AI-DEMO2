// Maps (declared permission, operator's token scopes, customer verification)
// to the single state that drives both the button and the evidence rail.
//
// An action with no permission entry resolves to 'denied'. Treating a missing
// entry as an implicit allow would make forgetting to declare one a silent
// privilege grant.

export const PERMISSION_LABEL = {
  allowed: 'Allowed',
  'verify-first': 'Verify first',
  approval: 'Needs approval',
  denied: 'Denied',
};

export function resolvePermission({ permission, scopes, verified }) {
  if (!permission) return 'denied';
  if (permission.gate === 'never') return 'denied';
  if (!Array.isArray(scopes) || !scopes.includes(permission.scope)) return 'denied';
  if (permission.gate === 'approval') return 'approval';
  if (permission.gate === 'verified' && !verified) return 'verify-first';
  return 'allowed';
}
