'use strict';

/**
 * Per-session context of the AG-UI run in flight: the browser's flowTraceId
 * (live MCP flow SSE) and the clicked useCaseId. agentRun sets it; the agent
 * service's tool callback (/internal/agent-tool) reads it.
 *
 * Deliberately NOT kept on the express session. The session is last-write-wins
 * across concurrent requests: a request that loaded it before agentRun saved
 * (e.g. the mode picker's POST /api/langchain/config, which awaits configStore
 * before saving) wrote its stale copy back over the trace id, so every pipeline
 * phase of that run was published to no trace and the flow panel showed no hops.
 *
 * An entry lives only while its run is open — agentRun clears it when the
 * response closes — so guest session churn cannot grow the map. In-process
 * Map: the same single-BFF-process assumption mcpFlowSseHub makes; move to a
 * shared store if the BFF ever runs multiple replicas.
 */
const runs = new Map();

/**
 * Register the context of a run that is starting. Replaces any earlier run's.
 * @param {string} sessionId
 * @param {{ flowTraceId?: string, useCaseId?: string }} ctx
 * @returns {object|null} the stored entry — pass it to clearRunContext
 */
function setRunContext(sessionId, { flowTraceId, useCaseId } = {}) {
  if (!sessionId) return null;
  const entry = { flowTraceId: flowTraceId || null, useCaseId: useCaseId || null };
  runs.set(sessionId, entry);
  return entry;
}

/**
 * Drop a run's entry when it ends — unless a newer run in the same session has
 * already replaced it.
 * @param {string} sessionId
 * @param {object|null} entry — what setRunContext returned for that run
 */
function clearRunContext(sessionId, entry) {
  if (sessionId && runs.get(sessionId) === entry) runs.delete(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {{ flowTraceId: string|null, useCaseId: string|null }}
 */
function getRunContext(sessionId) {
  return (sessionId && runs.get(sessionId)) || { flowTraceId: null, useCaseId: null };
}

module.exports = { setRunContext, clearRunContext, getRunContext };
