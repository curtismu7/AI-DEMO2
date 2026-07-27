// Status probe for the local Policy-as-Code editor (scripts/pac-edit.sh).
//
// The demo UI is served over HTTPS and the editor is plain HTTP on loopback, so
// this is a mixed-content request. It is also cross-origin against a server that
// sends no CORS headers. Hence mode: 'no-cors' — the response is opaque and
// unreadable, but the fact that it resolved proves something is listening, which
// is the whole signal a status indicator needs.
//
// A refused connection and a browser-blocked request are BOTH a plain TypeError;
// browsers withhold the difference so pages cannot port-scan localhost. So a
// failed probe means "not detected", never "definitely not running".
//
// This deliberately bypasses `apiClient` (see demo_api_ui/CLAUDE.md's "HTTP —
// go through apiClient" rule): apiClient is axios with `withCredentials: true`
// and a BFF baseURL, and axios cannot issue a `mode: 'no-cors'` request, which
// this probe needs. Side effect: this request is invisible to the inspector's
// traffic capture, which only observes apiClient/fetch traffic patched for
// that purpose.

export const PAC_EDITOR_URL = 'http://127.0.0.1:9099';
export const PAC_EDITOR_COMMAND = './scripts/pac-edit.sh';

export async function probePacEditor(fetchImpl = fetch, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(PAC_EDITOR_URL, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return 'running';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
