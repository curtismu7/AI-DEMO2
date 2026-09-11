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
 * ponytail: in-process Map, one entry per session that ran the agent — the same
 * single-BFF-process assumption mcpFlowSseHub makes. Move to a shared store if
 * the BFF ever runs multiple replicas.
 */
const runs = new Map();

/**
 * @param {string} sessionId
 * @param {{ flowTraceId?: string, useCaseId?: string }} ctx
 */
function setRunContext(sessionId, { flowTraceId, useCaseId } = {}) {
  if (!sessionId) return;
  const prev = runs.get(sessionId) || {};
  runs.set(sessionId, {
    // Same rules the session fields had: keep the previous trace when this run
    // sends none; always overwrite useCaseId so a stale one never leaks into a
    // later run that clicked nothing.
    flowTraceId: flowTraceId || prev.flowTraceId || null,
    useCaseId: useCaseId || null,
  });
}

/**
 * @param {string} sessionId
 * @returns {{ flowTraceId: string|null, useCaseId: string|null }}
 */
function getRunContext(sessionId) {
  return (sessionId && runs.get(sessionId)) || { flowTraceId: null, useCaseId: null };
}

module.exports = { setRunContext, getRunContext };
