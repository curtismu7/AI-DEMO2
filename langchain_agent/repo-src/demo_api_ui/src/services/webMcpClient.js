// banking_api_ui/src/services/webMcpClient.js
/**
 * Browser-side MCP client service.
 *
 * Communicates with the existing MCP server through the BFF proxy.
 * The BFF handles WebSocket transport to the MCP server — the browser
 * uses HTTP + SSE which is the practical browser pattern.
 *
 * Endpoints used (all pre-existing in BFF):
 *   GET  /api/mcp/inspector/tools         → tool catalog
 *   POST /api/mcp/tool                    → call a tool
 *   GET  /api/mcp/tool/events?trace=<id>  → SSE stream of pipeline phases
 */

/**
 * Fetch the list of available MCP tools from the BFF.
 * @returns {Promise<{ tools: Array<{ name: string, description: string, inputSchema: object }> }>}
 */
export async function listMcpTools() {
  const res = await fetch('/api/mcp/inspector/tools', {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`listMcpTools failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/**
 * Open an SSE stream that emits discovery phase events for an in-flight
 * GET /api/mcp/inspector/tools call. Mirrors the lifecycle of
 * openMcpToolStream: client subscribes first, then issues the GET with the
 * same trace id, and the BFF publishes phases as it walks the chain.
 *
 * @param {string} traceId — UUID matching the ?trace= query on the GET
 * @param {(phase: object) => void} onPhase — called for each parsed phase event
 * @returns {() => void} disconnect (idempotent)
 */
export function openMcpDiscoveryStream(traceId, onPhase) {
  if (!traceId || typeof onPhase !== 'function') {
    return () => {};
  }
  const url = `/api/mcp/inspector/tools/events?trace=${encodeURIComponent(traceId)}`;
  let es;
  try {
    es = new EventSource(url);
  } catch (_) {
    return () => {};
  }
  const handle = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && data.type === 'discovery-phase') onPhase(data);
      if (data && data.phase === 'stream_end' && es) es.close();
    } catch (_) {
      /* ignore malformed chunks */
    }
  };
  es.addEventListener('message', handle);
  // EventSource fires `error` both on transient network blips (readyState ===
  // CONNECTING, auto-reconnect will kick in) and on the server's clean stream
  // close via res.end (readyState === CLOSED). Only force-close on the
  // already-closed case — letting transient errors live lets the browser's
  // built-in reconnect deliver any remaining buffered phases.
  es.onerror = () => {
    if (es && es.readyState === 2 /* EventSource.CLOSED */) {
      try { es.close(); } catch (_) {}
    }
  };
  return () => { try { es.close(); } catch (_) {} };
}

/**
 * Fetch the list of available MCP tools from the BFF while streaming the
 * discovery phases (introspect → exchange → ws-connect → tools/list) to
 * `onPhase`. Falls back to a phaseless GET when the caller didn't supply a
 * trace id, didn't supply an onPhase handler, or the runtime has no
 * EventSource (e.g. jsdom).
 *
 * Pass `signal` (an AbortSignal) to tear down both the EventSource and the
 * fetch when the caller unmounts mid-discovery — closes the React
 * setState-after-unmount race in StrictMode dev double-mount and on early
 * route navigation. Already-aborted signals are honored synchronously.
 */
export async function listMcpToolsWithStream(traceId, onPhase, signal) {
  let disconnect = () => {};
  if (
    traceId &&
    typeof onPhase === 'function' &&
    typeof EventSource !== 'undefined'
  ) {
    disconnect = openMcpDiscoveryStream(traceId, onPhase);
  }
  const onAbort = () => disconnect();
  if (signal) {
    if (signal.aborted) disconnect();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const url = traceId
      ? `/api/mcp/inspector/tools?trace=${encodeURIComponent(traceId)}`
      : '/api/mcp/inspector/tools';
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`listMcpTools failed: ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return await res.json();
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    disconnect();
  }
}

/**
 * Call an MCP tool via the BFF proxy.
 * @param {string} toolName   - registered tool name
 * @param {object} params     - tool input parameters
 * @param {string} flowTraceId - UUID linking POST and SSE stream
 * @returns {Promise<object>}  - tool result JSON
 */
export async function callMcpTool(toolName, params, flowTraceId) {
  const res = await fetch('/api/mcp/tool', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolName, params, flowTraceId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`callMcpTool failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/**
 * Open an SSE stream for a tool call's pipeline phases.
 * Mirrors the pattern from mcpFlowSseClient.js — the BFF pushes events
 * over its WebSocket connection to the MCP server and relays them as SSE.
 *
 * @param {string} traceId        - UUID matching the flowTraceId on POST
 * @param {(data: object) => void} onEvent - called for each parsed SSE message
 * @returns {() => void} disconnect (idempotent)
 */
export function openMcpToolStream(traceId, onEvent) {
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
    try { es.close(); } catch (_) {}
  };

  return () => {
    try { es.close(); } catch (_) {}
  };
}
