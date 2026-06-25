// banking_api_ui/src/services/mcpFlowSseClient.js
/**
 * Subscribe to BFF Server-Sent Events for POST /api/mcp/tool pipeline phases.
 * Same-origin EventSource includes session cookies (no extra options in browsers).
 *
 * @param {string} traceId - UUID; must match flowTraceId on the POST body
 * @param {(data: object) => void} onEvent - parsed JSON from each `data:` line
 * @returns {() => void} disconnect (idempotent)
 */
export function openMcpFlowSse(traceId, onEvent) {
  if (!traceId || typeof onEvent !== 'function') {
    return () => {};
  }
  const url = `/api/mcp/tool/events?trace=${encodeURIComponent(traceId)}`;
  let es;
  try {
    es = new EventSource(url);
  } catch (_) {
    return () => {};
  }

  const handleMessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onEvent(data);
      if (data && data.phase === 'stream_end' && es) {
        es.close();
      }
    } catch (_) {
      /* ignore malformed chunks */
    }
  };

  es.addEventListener('message', handleMessage);
  es.onerror = () => {
    try {
      es.close();
    } catch (_) {}
  };

  return () => {
    try {
      es.close();
    } catch (_) {}
  };
}
