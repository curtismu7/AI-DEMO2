// banking_api_ui/src/services/mcpCallStore.js
/**
 * Lightweight in-memory store for MCP tool call history.
 *
 * Separate from the heavy apiTrafficStore so updates are synchronous and
 * reliable — no async body-reading race like patchFetch.
 * Pattern mirrors TokenChainContext ("like token chain but simpler").
 *
 * Usage:
 *   appendMcpCall(tool, status, duration, result, error)  → from bankingAgentService
 *   getCalls()                                             → current snapshot
 *   subscribe(fn)                                          → live updates; returns unsub()
 */

const MAX_CALLS = 50;
let calls       = [];
let seq         = 0;
const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(calls); } catch (_) {} });
}

/**
 * Record one completed (or failed) MCP tool call.
 *
 * @param {string}      tool       MCP tool name (e.g. 'get_my_accounts')
 * @param {number}      status     HTTP status code (0 = network/timeout error)
 * @param {number|null} duration   Round-trip ms, or null
 * @param {any}         result     Parsed JSON response body (or null on error)
 * @param {string|null} errorMsg   Error message if the call failed
 */
export function appendMcpCall(tool, status, duration, result, errorMsg = null) {
  calls = [
    {
      id:        ++seq,
      tool,
      status,
      duration,
      result,
      errorMsg,
      timestamp: new Date().toISOString(),
    },
    ...calls.slice(0, MAX_CALLS - 1),
  ];
  notify();
}

/** Return current snapshot (most-recent first). */
export function getCalls() { return calls; }

/**
 * Subscribe to updates.
 * @param {(calls: object[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearCalls() {
  calls = [];
  notify();
}
