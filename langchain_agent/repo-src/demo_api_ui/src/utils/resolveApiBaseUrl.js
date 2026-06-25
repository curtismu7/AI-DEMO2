// banking_api_ui/src/utils/resolveApiBaseUrl.js
/**
 * Base URL for axios calls from the SPA.
 *
 * If REACT_APP_API_URL is the same host as the page but a different port (typical
 * local dev: UI :3000, API :3001), return '' so requests go to the CRA dev server
 * and the `proxy` in package.json forwards `/api` to banking_api_server. That keeps
 * session cookies aligned with OAuth (callback often hits the API port directly;
 * calling `/api` on the UI port reuses the same host cookie and avoids brittle
 * cross-origin credential behavior).
 *
 * For production (Vercel) REACT_APP_API_URL is usually empty — same origin.
 * For split deployments (SPA and API on different hosts), keep REACT_APP_API_URL
 * pointing at the API origin; CORS + credentials must be configured server-side.
 */
export function resolveApiBaseUrl() {
  const env = process.env.REACT_APP_API_URL || '';
  if (typeof window === 'undefined') return env;
  if (!env.trim()) return '';

  try {
    const u = new URL(env.includes('://') ? env : `http://${env}`);
    const loc = window.location;
    if (u.hostname === loc.hostname && String(u.port || '') !== String(loc.port || '')) {
      return '';
    }
  } catch {
    return env;
  }
  return env;
}
