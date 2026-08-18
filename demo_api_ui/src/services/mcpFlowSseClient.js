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

  // A transient disconnect makes EventSource fire onerror while the browser
  // auto-reconnects. Permanently closing on the first error kills that
  // reconnect and drops the rest of the pipeline — including the stream_end
  // that legitimately ends the stream. So only close on a terminal condition;
  // let stream_end own normal completion.
  const MAX_CONSECUTIVE_ERRORS = 6;
  let consecutiveErrors = 0;

  const handleMessage = (ev) => {
    consecutiveErrors = 0;
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
    consecutiveErrors += 1;
    // Close only when the browser has given up (readyState CLOSED) or too many
    // errors arrive without an intervening message — otherwise let the built-in
    // reconnect run so remaining events (and stream_end) still arrive.
    if (
      es.readyState === EventSource.CLOSED ||
      consecutiveErrors >= MAX_CONSECUTIVE_ERRORS
    ) {
      try {
        es.close();
      } catch (_) {}
    }
  };

  return () => {
    try {
      es.close();
    } catch (_) {}
  };
}
