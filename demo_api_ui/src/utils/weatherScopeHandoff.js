// The weather showcase resets the gateway's allowed-state flag when its control
// unmounts, so a scope left on "Any" can't make UC31 permit on a later pass of
// the script. But the page's own Run button unmounts it on the way to the
// dashboard, which undid the reconfiguration before the run it was made for
// (UC32). The page marks that navigation, the control hands the reset to the
// dashboard instead of resetting on the way out, and the dashboard restores the
// default once that run has finished.
export const WEATHER_SCOPE_FLAG_ID = 'ff_weather_mcp_allowed_state';
// The flag's registered default (routes/featureFlags.js). UC30/UC31 in the Demo
// Steps script assume it: Austin permits, Miami denies.
export const WEATHER_SCOPE_DEFAULT = 'texas';

const LEAVING_TO_RUN = 'weatherScope.leavingToRun';
const RESTORE_AFTER_RUN = 'weatherScope.restoreAfterRun';
// The control unmounts in the same tick the page navigates. An older marker is
// one nobody consumed, and it must not suppress a later, genuine reset.
const LEAVING_TO_RUN_TTL_MS = 5000;

function session() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function markLeavingToRun(now = Date.now()) {
  session()?.setItem(LEAVING_TO_RUN, String(now));
}

export function takeLeavingToRun(now = Date.now()) {
  const s = session();
  const at = Number(s?.getItem(LEAVING_TO_RUN));
  s?.removeItem(LEAVING_TO_RUN);
  return at > 0 && now - at <= LEAVING_TO_RUN_TTL_MS;
}

export function markRestoreAfterRun() {
  session()?.setItem(RESTORE_AFTER_RUN, '1');
}

export function takeRestoreAfterRun() {
  const s = session();
  const pending = s?.getItem(RESTORE_AFTER_RUN) === '1';
  s?.removeItem(RESTORE_AFTER_RUN);
  return pending;
}

/** Put the scope back if a handed-off run just ended. Returns whether it did. */
export function restoreDefaultScopeAfterRun(client) {
  if (!takeRestoreAfterRun()) return false;
  Promise.resolve()
    .then(() => client.patch('/api/admin/feature-flags', {
      updates: { [WEATHER_SCOPE_FLAG_ID]: WEATHER_SCOPE_DEFAULT },
    }))
    .catch(() => { /* best-effort — reset-demo remains the backstop */ });
  return true;
}
