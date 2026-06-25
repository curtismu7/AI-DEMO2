// banking_api_ui/src/services/accountsHydration.js
/**
 * Retries GET /api/accounts/my after customer OAuth: session/JWT may lag behind
 * oauth status, provision can race, and 5xx/503 can occur on cold starts.
 */

export const ACCOUNT_FETCH_MAX_ATTEMPTS = 5;
export const ACCOUNT_FETCH_DELAYS_MS = [0, 400, 800, 1200, 1600];

/**
 * Returns true for errors worth retrying while hydrating accounts (network, 5xx).
 * Does not retry 429 — caller should surface rate-limit UX.
 * @param {import('axios').AxiosError} error
 */
export function isAccountsHydrationTransientError(error) {
  const status = error.response?.status;
  if (!status) return true;
  if (status === 429) return false;
  return status >= 500;
}

/**
 * Fetches `/api/accounts/my` with retries for 401 (session settling), transient errors,
 * and empty lists (provision race). Throws the last error if every attempt failed.
 * @param {import('axios').AxiosInstance} bffAxios
 * @param {{ isUserLoggedOut?: () => boolean }} [options]
 * @returns {Promise<Array>}
 */
export async function fetchMyAccountsWithResilience(bffAxios, options = {}) {
  const isUserLoggedOut = options.isUserLoggedOut ?? (() => localStorage.getItem('userLoggedOut') === 'true');

  let lastError = null;
  let sawSuccess = false;

  for (let attempt = 0; attempt < ACCOUNT_FETCH_MAX_ATTEMPTS; attempt++) {
    const delayMs = ACCOUNT_FETCH_DELAYS_MS[attempt] ?? ACCOUNT_FETCH_DELAYS_MS[ACCOUNT_FETCH_DELAYS_MS.length - 1];
    if (delayMs) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const accountsResponse = await bffAxios.get('/api/accounts/my');
      sawSuccess = true;
      const list = Array.isArray(accountsResponse.data?.accounts)
        ? accountsResponse.data.accounts
        : [];
      if (list.length > 0) return list;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status === 401 && isUserLoggedOut()) throw error;
      if (status === 401) continue;
      if (isAccountsHydrationTransientError(error)) continue;
      throw error;
    }
  }

  if (!sawSuccess && lastError) throw lastError;
  return [];
}
