// banking_api_ui/src/services/demoScenarioService.js

function apiError(res, data) {
  const err = new Error(data.message || data.error || `HTTP ${res.status}`);
  err.code = data.error;
  err.status = res.status;
  return err;
}

/** Coalesce concurrent GETs (React Strict Mode double-mount, multiple listeners). */
let fetchDemoScenarioInflight = null;

export async function fetchDemoScenario() {
  if (fetchDemoScenarioInflight) {
    return fetchDemoScenarioInflight;
  }
  fetchDemoScenarioInflight = (async () => {
    try {
      const res = await fetch('/api/demo-scenario', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return null; // not logged in — caller handles gracefully
      if (!res.ok) throw apiError(res, data);
      return data;
    } finally {
      fetchDemoScenarioInflight = null;
    }
  })();
  return fetchDemoScenarioInflight;
}

export async function saveDemoScenario(body) {
  const res = await fetch('/api/demo-scenario', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res, data);
  return data;
}

/**
 * Persists agent UI (placement + FAB) to the signed-in user's demo scenario (KV when configured).
 * @param {{ placement: 'middle' | 'bottom' | 'none'; fab: boolean }} state
 * @returns {Promise<boolean>}
 */
export async function persistAgentUi(state) {
  try {
    const res = await fetch('/api/demo-scenario', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankingAgentUi: state }),
    });
    if (!res.ok) {
      if (res.status !== 401) await res.json().catch(() => ({}));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {'floating' | 'embedded' | 'both'} mode
 * @returns {Promise<boolean>}
 */
async function persistAgentUiMode(mode) {
  const state =
    mode === 'embedded'
      ? { placement: 'bottom', fab: false }
      : mode === 'both'
        ? { placement: 'bottom', fab: true }
        : { placement: 'none', fab: true };
  return persistAgentUi(state);
}
