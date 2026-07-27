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
